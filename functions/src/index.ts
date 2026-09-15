import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp();
}

const auth = getAuth();
const firestore = getFirestore();

// Cloud Function: When a staff document is created in Firestore,
// automatically create the Firebase Auth user
export const onStaffCreated = onDocumentCreated('staff/{staffId}', async (event) => {
  const snap = event.data;
  const staffId = event.params.staffId;

  if (!snap) {
    console.log('No data in staff document');
    return;
  }

  const staffData = snap.data();

  if (!staffData || !staffData.email || !staffData.passwordHash) {
    console.log('Staff document missing email or password, skipping Auth creation');
    return;
  }

  const { email, passwordHash, name, role, homeId } = staffData;

  try {
    // Check if user already exists in Auth
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`User ${email} already exists in Auth, updating...`);
      await auth.updateUser(userRecord.uid, { password: passwordHash });
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email,
          password: passwordHash,
          displayName: name,
          emailVerified: true,
          disabled: false,
        });
        console.log(`Created new Auth user: ${userRecord.uid} for ${email}`);
      } else {
        throw e;
      }
    }

    // Set custom claims
    await auth.setCustomUserClaims(userRecord.uid, { role, homeId });
    console.log(`Set custom claims for ${email}: role=${role}, homeId=${homeId}`);

    // Update the staff document with the Auth UID if different
    if (userRecord.uid !== staffId) {
      await firestore.collection('staff').doc(userRecord.uid).set({
        ...staffData,
        id: userRecord.uid,
      }, { merge: true });
      await snap.ref.delete();
      console.log(`Migrated staff document from ${staffId} to ${userRecord.uid}`);
    }

    return { success: true, uid: userRecord.uid };
  } catch (error) {
    console.error(`Error creating Auth user for ${email}:`, error);
    return { success: false, error: String(error) };
  }
});

// Cloud Function: When a staff document is updated, sync Auth claims
export const onStaffUpdated = onDocumentUpdated('staff/{staffId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const staffId = event.params.staffId;

  if (!before || !after) return;

  if (before.role === after.role && before.homeId === after.homeId) {
    return;
  }

  try {
    await auth.setCustomUserClaims(staffId, {
      role: after.role,
      homeId: after.homeId,
    });
    console.log(`Updated Auth claims for ${staffId}: role=${after.role}, homeId=${after.homeId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error updating Auth claims for ${staffId}:`, error);
    return { success: false, error: String(error) };
  }
});

// Cloud Function: When a staff document is deleted, disable the Auth user
export const onStaffDeleted = onDocumentDeleted('staff/{staffId}', async (event) => {
  const staffId = event.params.staffId;

  try {
    await auth.updateUser(staffId, { disabled: true });
    console.log(`Disabled Auth user: ${staffId}`);
    return { success: true };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log(`Auth user ${staffId} not found, may already be deleted`);
      return { success: true };
    }
    console.error(`Error disabling Auth user ${staffId}:`, error);
    return { success: false, error: String(error) };
  }
});
