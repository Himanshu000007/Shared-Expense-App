// Groups feature — create/list/read groups and manage time-bounded membership.
// Also exports helpers (assertGroupAccess, loadMembers, today) reused by the
// expenses / settlements / balances features.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query } from './db.js';
import { ApiError } from './helpers.js';
import { requireAuth, validate } from './middleware.js';

// --- 1. validation ---------------------------------------------------------
const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'required').max(100, 'max 100 chars'),
  baseCurrency: z.string().trim().length(3, 'use a 3-letter code').toUpperCase().optional(),
});

const addMemberSchema = z.object({
  displayName: z.string().trim().min(1, 'required').max(80, 'max 80 chars'),
  isGuest: z.boolean().optional(),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional(),
  userId: z.string().uuid().optional(),
});

const updateMemberSchema = z.object({
  leftAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullable().optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
});

// --- 2. shared helpers (exported) ------------------------------------------
export const today = () => new Date().toISOString().slice(0, 10);

// Ensure the group exists and the caller may act on it (creator or a member
// linked to their user account). Returns the group row.
export async function assertGroupAccess(groupId, userId) {
  const { rows } = await query('SELECT * FROM `groups` WHERE id = ?', [groupId]);
  const group = rows[0];
  if (!group) throw new ApiError(404, 'Group not found');

  if (group.created_by === userId) return group;
  const { rows: m } = await query(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1',
    [groupId, userId]
  );
  if (m.length === 0) throw new ApiError(403, 'You are not a member of this group');
  return group;
}

export async function loadMembers(groupId) {
  const { rows } = await query(
    'SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at, display_name',
    [groupId]
  );
  return rows;
}

// True if `date` (YYYY-MM-DD) falls within a member's [joined_at, left_at] window.
export function isActiveOn(member, date) {
  if (date < member.joined_at) return false;
  if (member.left_at && date > member.left_at) return false;
  return true;
}

const publicMember = (m) => ({
  id: m.id,
  displayName: m.display_name,
  isGuest: !!m.is_guest,
  userId: m.user_id,
  joinedAt: m.joined_at,
  leftAt: m.left_at,
});

// --- 3. routes -------------------------------------------------------------
const router = Router();
router.use(requireAuth);

// Create a group; the creator is auto-added as the first member.
router.post('/', validate(createGroupSchema), async (req, res, next) => {
  try {
    const groupId = randomUUID();
    const baseCurrency = req.body.baseCurrency || 'INR';
    await query(
      'INSERT INTO `groups` (id, name, base_currency, created_by) VALUES (?, ?, ?, ?)',
      [groupId, req.body.name, baseCurrency, req.userId]
    );

    // Auto-add the creator as the first member, joined today.
    const { rows: u } = await query('SELECT name FROM users WHERE id = ?', [req.userId]);
    await query(
      `INSERT INTO group_members (id, group_id, user_id, display_name, is_guest, joined_at)
       VALUES (?, ?, ?, ?, FALSE, ?)`,
      [randomUUID(), groupId, req.userId, u[0].name, today()]
    );

    const { rows } = await query('SELECT * FROM `groups` WHERE id = ?', [groupId]);
    res.status(201).json({ group: rows[0], members: (await loadMembers(groupId)).map(publicMember) });
  } catch (err) {
    next(err);
  }
});

// List groups the caller belongs to (created, or linked as a member).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT g.* FROM \`groups\` g
       LEFT JOIN group_members m ON m.group_id = g.id
       WHERE g.created_by = ? OR m.user_id = ?
       ORDER BY g.created_at DESC`,
      [req.userId, req.userId]
    );
    res.json({ groups: rows });
  } catch (err) {
    next(err);
  }
});

// Group detail + members.
router.get('/:id', async (req, res, next) => {
  try {
    const group = await assertGroupAccess(req.params.id, req.userId);
    res.json({ group, members: (await loadMembers(group.id)).map(publicMember) });
  } catch (err) {
    next(err);
  }
});

// List members.
router.get('/:id/members', async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    res.json({ members: (await loadMembers(req.params.id)).map(publicMember) });
  } catch (err) {
    next(err);
  }
});

// Add a member (free-text name; guests have no user account).
router.post('/:id/members', validate(addMemberSchema), async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const id = randomUUID();
    await query(
      `INSERT INTO group_members (id, group_id, user_id, display_name, is_guest, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.params.id,
        req.body.userId || null,
        req.body.displayName,
        req.body.isGuest ? 1 : 0,
        req.body.joinedAt || today(),
      ]
    );
    const { rows } = await query('SELECT * FROM group_members WHERE id = ?', [id]);
    res.status(201).json({ member: publicMember(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Update a member — typically to set left_at when they move out.
router.patch('/:id/members/:memberId', validate(updateMemberSchema), async (req, res, next) => {
  try {
    await assertGroupAccess(req.params.id, req.userId);
    const fields = [];
    const params = [];
    if ('leftAt' in req.body) { fields.push('left_at = ?'); params.push(req.body.leftAt); }
    if (req.body.displayName) { fields.push('display_name = ?'); params.push(req.body.displayName); }
    if (fields.length === 0) throw new ApiError(400, 'nothing to update');

    params.push(req.params.memberId, req.params.id);
    const { rows: result } = await query(
      `UPDATE group_members SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`,
      params
    );
    if (result.affectedRows === 0) throw new ApiError(404, 'Member not found');

    const { rows } = await query('SELECT * FROM group_members WHERE id = ?', [req.params.memberId]);
    res.json({ member: publicMember(rows[0]) });
  } catch (err) {
    next(err);
  }
});

export default router;
