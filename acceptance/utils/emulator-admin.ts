import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { SeededTask } from '../data/builders/task.builder';
import type { RegisteredUser, TestUser } from '../data/builders/user.builder';
import { getEmulatorProjectId } from './env';

const ALLOWED_USERS = 'allowedUsers';
const TASKS = 'tasks';
const TASK_INDEX = 'taskIndex';

// Admin SDK pointed at the emulators (firebase emulators:exec exports their hosts). It bypasses the
// security rules, the same way the console does: it plays the administrator who authorizes people.
export class EmulatorAdmin {
  private readonly app: App;
  private readonly auth: Auth;
  private readonly firestore: Firestore;

  constructor() {
    this.app = initializeApp({ projectId: getEmulatorProjectId() }, `e2e-${randomUUID()}`);
    this.auth = getAuth(this.app);
    this.firestore = getFirestore(this.app);
  }

  // Account in Authentication, with a verified email, but no access to LUCAS.
  async createAccount(user: TestUser): Promise<RegisteredUser> {
    const { uid } = await this.auth.createUser({
      email: user.email,
      password: user.password,
      displayName: user.name,
      emailVerified: true,
    });
    return { ...user, uid };
  }

  // Account plus its allowedUsers document (ALTA_USUARIO_LUCAS.md): the app writes the uid on first access.
  async registerUser(user: TestUser): Promise<RegisteredUser> {
    const registered = await this.createAccount(user);
    await this.firestore
      .collection(ALLOWED_USERS)
      .doc(user.email.toLowerCase())
      .set({ name: user.name, role: user.role, active: user.isActive });
    return registered;
  }

  async seedTasks(owner: RegisteredUser, tasks: SeededTask[]): Promise<void> {
    const batch = this.firestore.batch();
    tasks.forEach(({ id, subtasks, dueDate, ...fields }) => {
      const openSubtasks = subtasks.filter((subtask) => !subtask.done).length;
      batch.set(this.firestore.collection(TASKS).doc(id), {
        ...fields,
        ownerId: owner.uid,
        ...(dueDate === null ? {} : { dueDate }),
        ...(subtasks.length === 0 ? {} : { subtasks, openSubtasks }),
      });
      batch.set(this.firestore.collection(TASK_INDEX).doc(id), { ownerId: owner.uid });
    });
    await batch.commit();
  }

  async getTaskTexts(owner: RegisteredUser): Promise<string[]> {
    const snapshot = await this.firestore.collection(TASKS).where('ownerId', '==', owner.uid).get();
    return snapshot.docs.map((document) => String(document.get('text')));
  }

  async close(): Promise<void> {
    await deleteApp(this.app);
  }
}
