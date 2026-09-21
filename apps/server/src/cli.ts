/**
 * Admin tools for when you are locked out or the web UI is not available.
 *
 *   npm run admin -- users
 *   npm run admin -- reset-password <username> [new-password]
 *   npm run admin -- make-admin <username>
 *   npm run admin -- create-admin <username> <password>
 *
 * In Docker: docker compose exec app npm run admin -- reset-password <username>
 */
import { randomBytes } from 'node:crypto';
import { createAccount, listUsers, setUserPassword, setUserRole } from './services/auth.js';

const [command, ...args] = process.argv.slice(2);
const fail = (message: string): never => { console.error(message); process.exit(1); };
const findUser = (name?: string) => listUsers().find(u => u.username.toLowerCase() === (name ?? '').toLowerCase()) ?? fail(`No account called "${name ?? ''}". Run "users" to list them.`);

switch (command) {
  case 'users': {
    const users = listUsers();
    if (users.length === 0) console.log('No accounts yet. The first one is created in the web app, or with create-admin.');
    for (const u of users) console.log(`${u.role === 'admin' ? 'admin' : 'user '}  ${u.username}  (joined ${u.createdAt.slice(0, 10)})`);
    break;
  }
  case 'reset-password': {
    const user = findUser(args[0]);
    const password = args[1] ?? randomBytes(6).toString('base64url');
    const result = setUserPassword(user.id, password);
    if (!result.ok) fail(result.message ?? 'Could not set the password.');
    console.log(`Password for ${user.username} is now: ${password}`);
    console.log('They were signed out everywhere. Change it after signing in.');
    break;
  }
  case 'make-admin': {
    const user = findUser(args[0]);
    const result = setUserRole(user.id, 'admin');
    if (!result.ok) fail(result.message ?? 'Could not change the role.');
    console.log(`${user.username} is now an administrator.`);
    break;
  }
  case 'create-admin': {
    if (!args[0] || !args[1]) fail('Usage: create-admin <username> <password>');
    const created = createAccount(args[0]!, args[1]!, 'admin');
    if (!created.ok) fail(created.message);
    console.log(`Created ${args[0]}. Note: the first account ever created is always an administrator; later ones need make-admin.`);
    const user = listUsers().find(u => u.username === args[0]);
    if (user && user.role !== 'admin') { setUserRole(user.id, 'admin'); console.log('Promoted to administrator.'); }
    break;
  }
  default:
    console.log('Commands: users | reset-password <username> [password] | make-admin <username> | create-admin <username> <password>');
    process.exit(command ? 1 : 0);
}
