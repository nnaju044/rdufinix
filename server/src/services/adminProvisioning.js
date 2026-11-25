export async function provisionInitialAdmin({ env, connect, User }) {
  const name = env.INITIAL_ADMIN_NAME?.trim();
  const email = env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.INITIAL_ADMIN_PASSWORD;
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set a valid INITIAL_ADMIN_NAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD (12-72 UTF-8 bytes).');
  }
  await connect();
  if (await User.exists({ email })) throw new Error(`A user already exists for ${email}`);
  const user = new User({ name, email, role: 'admin', active: true });
  await user.setPassword(password);
  await user.save();
  return { email };
}
