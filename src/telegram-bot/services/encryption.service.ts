import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-cbc';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const privateKey = this.configService.get<string>('PRIVATE_KEY');
    if (!privateKey) {
      this.logger.warn('PRIVATE_KEY not configured, encryption will not work');
      this.key = crypto.scryptSync('default-key', 'salt', 32);
    } else {
      this.key = crypto.scryptSync(privateKey, 'salt', 32);
    }
  }

  private evpBytesToKey(
    password: Buffer,
    salt: Buffer,
    keyLen: number,
    ivLen: number,
  ): { key: Buffer; iv: Buffer } {
    let derivedKey = Buffer.alloc(0);
    let hash = Buffer.alloc(0);

    while (derivedKey.length < keyLen + ivLen) {
      const md5 = crypto.createHash('md5');
      md5.update(hash);
      md5.update(password);
      md5.update(salt);
      hash = Buffer.from(md5.digest());
      derivedKey = Buffer.concat([derivedKey, hash]);
    }

    return {
      key: derivedKey.slice(0, keyLen),
      iv: derivedKey.slice(keyLen, keyLen + ivLen),
    };
  }

  decrypt(encryptedText: string): string {
    try {
      if (!encryptedText.includes(':')) {
        try {
          const encryptedBuffer = Buffer.from(encryptedText, 'base64');

          if (
            encryptedBuffer.length >= 16 &&
            encryptedBuffer.slice(0, 8).toString() === 'Salted__'
          ) {
            const salt = encryptedBuffer.slice(8, 16);
            const encrypted = encryptedBuffer.slice(16);

            const privateKey =
              this.configService.get<string>('PRIVATE_KEY') || 'default-key';
            const password = Buffer.from(privateKey, 'utf8');

            const { key, iv } = this.evpBytesToKey(password, salt, 32, 16);

            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            return decrypted.toString('utf8');
          }
        } catch (openSslError) {
          this.logger.debug(
            'Failed to decrypt as OpenSSL format, trying hex format',
            openSslError,
          );
        }
      }

      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error(
          'Invalid encrypted format: expected "iv:encrypted" hex format or OpenSSL "Salted__" base64 format',
        );
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = Buffer.from(parts[1], 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error('Decryption error', error);
      throw new Error(`Ошибка расшифровки: ${error.message}`);
    }
  }

  encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      this.logger.error('Encryption error', error);
      throw new Error(`Ошибка шифрования: ${error.message}`);
    }
  }
}
