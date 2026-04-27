import { PrismaClient } from '@prisma/client';
import logger from './logger';

// Declare global variable for PrismaClient
declare global {
    var prisma: PrismaClient | undefined;
}

// Create a singleton Prisma client that can be shared across files
export const prisma = global.prisma || new PrismaClient({
    log: [],
});

// Prevent multiple instances during hot reloading in development
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

// Graceful shutdown function to close Prisma connections
export const disconnectPrisma = async () => {
    await prisma.$disconnect();
    logger.info('Disconnected from database');
};