"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onStaffDeleted = exports.onStaffUpdated = exports.onStaffCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const auth = admin.auth();
const firestore = admin.firestore();
// Cloud Function: When a staff document is created in Firestore,
// automatically create the Firebase Auth user
exports.onStaffCreated = (0, firestore_1.onDocumentCreated)('staff/{staffId}', async (event) => {
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
        }
        catch (e) {
            if (e.code === 'auth/user-not-found') {
                userRecord = await auth.createUser({
                    email,
                    password: passwordHash,
                    displayName: name,
                    emailVerified: true,
                    disabled: false,
                });
                console.log(`Created new Auth user: ${userRecord.uid} for ${email}`);
            }
            else {
                throw e;
            }
        }
        // Set custom claims
        await auth.setCustomUserClaims(userRecord.uid, { role, homeId });
        console.log(`Set custom claims for ${email}: role=${role}, homeId=${homeId}`);
        // Update the staff document with the Auth UID if different
        if (userRecord.uid !== staffId) {
            await firestore.collection('staff').doc(userRecord.uid).set(Object.assign(Object.assign({}, staffData), { id: userRecord.uid }), { merge: true });
            await snap.ref.delete();
            console.log(`Migrated staff document from ${staffId} to ${userRecord.uid}`);
        }
        return { success: true, uid: userRecord.uid };
    }
    catch (error) {
        console.error(`Error creating Auth user for ${email}:`, error);
        return { success: false, error: String(error) };
    }
});
// Cloud Function: When a staff document is updated, sync Auth claims
exports.onStaffUpdated = (0, firestore_1.onDocumentUpdated)('staff/{staffId}', async (event) => {
    var _a, _b;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    const staffId = event.params.staffId;
    if (!before || !after)
        return;
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
    }
    catch (error) {
        console.error(`Error updating Auth claims for ${staffId}:`, error);
        return { success: false, error: String(error) };
    }
});
// Cloud Function: When a staff document is deleted, disable the Auth user
exports.onStaffDeleted = (0, firestore_1.onDocumentDeleted)('staff/{staffId}', async (event) => {
    const staffId = event.params.staffId;
    try {
        await auth.updateUser(staffId, { disabled: true });
        console.log(`Disabled Auth user: ${staffId}`);
        return { success: true };
    }
    catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.log(`Auth user ${staffId} not found, may already be deleted`);
            return { success: true };
        }
        console.error(`Error disabling Auth user ${staffId}:`, error);
        return { success: false, error: String(error) };
    }
});
//# sourceMappingURL=index.js.map