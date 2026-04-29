import { prisma } from './prisma';
import type { Prisma } from '@prisma/client';
import logger from './logger';
import fs from 'fs';
import path from 'path';

// Function to migrate in-memory API keys to database
export const migrateApiKeys = async (inMemoryApiKeys: Map<string, any>) => {
    try {
        logger.info(`Starting migration of ${inMemoryApiKeys.size} API keys to database`);

        // Create a backup of in-memory keys
        const backupPath = path.join(__dirname, '../../backup-api-keys.json');
        const backupData = JSON.stringify(Array.from(inMemoryApiKeys.entries()), null, 2);
        fs.writeFileSync(backupPath, backupData);
        logger.info(`Backup of API keys created at ${backupPath}`);

        // Begin transaction
        const results = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const migrationResults = [];

            for (const [key, data] of inMemoryApiKeys.entries()) {
                // Check if key already exists in database
                const existingKey = await tx.apiKey.findUnique({
                    where: { key }
                });

                if (!existingKey) {
                    // Create new key in database
                    const newKey = await tx.apiKey.create({
                        data: {
                            key,
                            owner: data.owner,
                            usageCount: data.usageCount || 0,
                            lastUsed: data.lastUsed ? new Date(data.lastUsed) : null,
                            isActive: data.isActive !== false // Default to true if not specified
                        }
                    });

                    migrationResults.push({ key, status: 'created', id: newKey.id });
                } else {
                    migrationResults.push({ key, status: 'already_exists', id: existingKey.id });
                }
            }

            return migrationResults;
        });

        const created = results.filter((r: any) => r.status === 'created').length;
        const existing = results.filter((r: any) => r.status === 'already_exists').length;

        logger.info(`Migration completed: ${created} keys created, ${existing} keys already existed`);
        return { created, existing, total: inMemoryApiKeys.size };
    } catch (error) {
        logger.error('Error migrating API keys:', error);
        throw error;
    }
};

// Function to restore API keys from backup if needed
export const restoreApiKeysFromBackup = async () => {
    try {
        const backupPath = path.join(__dirname, '../../backup-api-keys.json');

        if (!fs.existsSync(backupPath)) {
            logger.error('Backup file not found');
            return { success: false, error: 'Backup file not found' };
        }

        const backupData = fs.readFileSync(backupPath, 'utf8');
        const apiKeys = JSON.parse(backupData);

        if (!Array.isArray(apiKeys)) {
            logger.error('Invalid backup format');
            return { success: false, error: 'Invalid backup format' };
        }

        const inMemoryMap = new Map(apiKeys);
        const result = await migrateApiKeys(inMemoryMap as Map<string, any>);

        return { success: true, ...result };
    } catch (error) {
        logger.error('Error restoring API keys from backup:', error);
        return { success: false, error: String(error) };
    }
};