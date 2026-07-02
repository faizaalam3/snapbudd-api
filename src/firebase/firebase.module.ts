import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { initializeApp, getApps } from 'firebase-admin/app';
import { FirebaseService } from './firebase.service';
import { resolveFirebaseCredential } from './firebase-credentials';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: FirebaseService,
      useFactory: (config: ConfigService) => {
        const projectId = config.get<string>('firebase.projectId');
        if (!getApps().length) {
          initializeApp({
            credential: resolveFirebaseCredential(),
            projectId,
          });
        }
        return new FirebaseService();
      },
      inject: [ConfigService],
    },
  ],
  exports: [FirebaseService],
})
export class FirebaseModule {}
