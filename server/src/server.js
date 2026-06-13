// Entry point. Loads env, builds the app, starts listening.
import 'dotenv/config';
import { createApp } from './app.js';

const PORT = process.env.PORT || 4000;

createApp().listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
