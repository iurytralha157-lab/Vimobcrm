import { seedE2EData } from './support/seed';

export default async function globalSetup() {
  await seedE2EData();
}
