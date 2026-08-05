import { randomInt } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();

// Keep the callable close to the Taiwan deployment and limit accidental scaling.
setGlobalOptions({ region: 'asia-east1', maxInstances: 5 });

const db = getFirestore();
const auth = getAuth();

const PASSWORD_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%'
];

function randomPassword(): string {
  const chars = PASSWORD_GROUPS.map(group => group[randomInt(group.length)]);
  const allChars = PASSWORD_GROUPS.join('');
  while (chars.length < 16) chars.push(allChars[randomInt(allChars.length)]);

  // Fisher-Yates with a cryptographically secure random index.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function requireAdmin(uid: string): Promise<void> {
  const [adminSnap, hrSnap] = await Promise.all([
    db.collection('users').doc('admin').get(),
    db.collection('users').doc('syhr').get()
  ]);

  const isAdmin = [adminSnap, hrSnap].some(snapshot => snapshot.exists && snapshot.data()?.uid === uid);
  if (!isAdmin) throw new HttpsError('permission-denied', '只有管理員可以執行此操作。');
}

function getTargetUserId(data: unknown): string {
  if (!data || typeof data !== 'object' || !('targetUserId' in data)) {
    throw new HttpsError('invalid-argument', '缺少員工帳號。');
  }

  const targetUserId = (data as { targetUserId?: unknown }).targetUserId;
  if (typeof targetUserId !== 'string') {
    throw new HttpsError('invalid-argument', '員工帳號格式不正確。');
  }

  const normalized = targetUserId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(normalized)) {
    throw new HttpsError('invalid-argument', '員工帳號格式不正確。');
  }
  return normalized;
}

/**
 * Resets an employee's Firebase Auth password without changing their UID.
 * The generated password is returned once to the authenticated administrator.
 */
export const resetEmployeePassword = onCall(async request => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', '請先登入。');

  await requireAdmin(callerUid);

  const targetUserId = getTargetUserId(request.data);
  if (targetUserId === 'admin' || targetUserId === 'syhr' || targetUserId === 'service') {
    throw new HttpsError('failed-precondition', '此帳號不可由員工密碼重設功能處理。');
  }

  const targetRef = db.collection('users').doc(targetUserId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new HttpsError('not-found', '找不到員工資料。');

  const target = targetSnap.data() ?? {};
  if (target.role !== 'employee' || typeof target.uid !== 'string' || !target.uid) {
    throw new HttpsError('failed-precondition', '目標不是可重設的員工帳號。');
  }
  if (target.deleted === true) {
    throw new HttpsError('failed-precondition', '封存帳號必須先恢復後才能重設密碼。');
  }

  const temporaryPassword = randomPassword();
  const resetAt = Timestamp.now();

  // Mark the profile first. If Auth fails, clear the marker so the account is
  // not left in a misleading forced-change state.
  await targetRef.update({
    mustChangePassword: true,
    passwordResetAt: resetAt,
    passwordResetBy: callerUid
  });

  try {
    await auth.updateUser(target.uid, { password: temporaryPassword });
    try {
      await auth.revokeRefreshTokens(target.uid);
    } catch (revokeError) {
      // Password rotation still succeeds, but retain an audit trail if token
      // revocation is temporarily unavailable.
      console.error('Existing session revocation failed', revokeError);
    }
  } catch (error) {
    try {
      await targetRef.update({
        mustChangePassword: false,
        passwordResetAt: FieldValue.delete(),
        passwordResetBy: FieldValue.delete()
      });
    } catch (rollbackError) {
      console.error('Password reset marker rollback failed', rollbackError);
    }
    console.error('Firebase Auth password reset failed', error);
    throw new HttpsError('internal', '密碼重設失敗，請稍後再試。');
  }

  try {
    await db.collection('security_logs').add({
      uid: callerUid,
      action: 'ADMIN_RESET_PASSWORD',
      details: `Reset password for ${targetUserId}`,
      timestamp: FieldValue.serverTimestamp(),
      userAgent: 'cloud-function'
    });
  } catch (logError) {
    // Never hide a successful password reset from the administrator because
    // an audit-log write is temporarily unavailable.
    console.error('Password reset audit log failed', logError);
  }

  return {
    userId: targetUserId,
    userName: typeof target.name === 'string' ? target.name : targetUserId,
    temporaryPassword
  };
});
