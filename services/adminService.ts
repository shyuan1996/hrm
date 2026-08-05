import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface PasswordResetResult {
  userId: string;
  userName: string;
  temporaryPassword: string;
}

const resetPasswordCallable = httpsCallable<
  { targetUserId: string },
  PasswordResetResult
>(functions, 'resetEmployeePassword');

export const AdminService = {
  resetEmployeePassword: async (targetUserId: string): Promise<PasswordResetResult> => {
    const result = await resetPasswordCallable({ targetUserId });
    return result.data;
  }
};
