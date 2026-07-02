import { Injectable } from '@nestjs/common';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

@Injectable()
export class FirebaseService {
  private readonly firestore: Firestore;
  private readonly firebaseAuth: Auth;

  constructor() {
    this.firestore = getFirestore();
    this.firebaseAuth = getAuth();
  }

  get db(): Firestore {
    return this.firestore;
  }

  get auth(): Auth {
    return this.firebaseAuth;
  }

  serverTimestamp(): FieldValue {
    return FieldValue.serverTimestamp();
  }

  increment(value: number): FieldValue {
    return FieldValue.increment(value);
  }
}
