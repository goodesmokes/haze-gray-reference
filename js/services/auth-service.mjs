import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase.mjs";

const AUTH_API = { onAuthStateChanged, signInWithEmailAndPassword, signOut };

export function createAuthService({ auth: authentication, api = AUTH_API, isOnline = () => globalThis.navigator?.onLine !== false }) {
  const signInWithEmail = async (email, password) => {
    if (!isOnline()) throw new Error("Sign-in requires a network connection.");
    return api.signInWithEmailAndPassword(authentication, email.trim(), password);
  };
  const signOutUser = () => api.signOut(authentication);
  const subscribeAuthState = (onUser) => api.onAuthStateChanged(authentication, onUser);

  return { signInWithEmail, signOutUser, subscribeAuthState };
}

export const { signInWithEmail, signOutUser, subscribeAuthState } = createAuthService({ auth });
