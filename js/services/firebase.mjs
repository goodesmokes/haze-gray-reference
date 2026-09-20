import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyDYzcHxcQNKUzoJWp4Jd2c67DAvc51N1Pk",
  authDomain: "haze-gray-cigars.firebaseapp.com",
  projectId: "haze-gray-cigars",
  storageBucket: "haze-gray-cigars.firebasestorage.app",
  messagingSenderId: "691261212011",
  appId: "1:691261212011:web:34ad8434b4a1c6f1dbb82e"
};
export const fbApp = initializeApp(firebaseConfig);
export const db = getFirestore(fbApp);
export const auth = getAuth(fbApp);
