import { createLogger, format, transports, Logger } from 'winston';
import 'winston-daily-rotate-file';

const { combine, timestamp, printf, errors, colorize } = format;

// 🎨 Fancy Console Format with Emojis and Timestamp
const emojiFormat = printf(info => {
    const { level, message, timestamp, stack, ...meta } = info;

    const emojis: Record<string, string> = {
        info: 'ℹ️ ',
        warn: '⚠️ ',
        error: '❌',
        debug: '🐛',
    };

    const emoji = emojis[level] || '';
    let log = `${emoji}[${timestamp}] ${level.toUpperCase()}: ${message}`;

    if (stack) {
        log += `\n🔍 Stack:\n${stack}`;
    }

    const { service, ...rest } = meta;
    const extraMeta = Object.keys(rest).length > 0 ? rest : null;

    if (extraMeta) {
        const formatted = JSON.stringify(extraMeta, null, 2).replace(/^/gm, '   › ');
        log += `\n📦 Metadata:\n${formatted}`;
    }

    return log;
});

// 📝 Plain Format for File Logging
const fileFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) {
        log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    return log;
});

// 🗂 Error Log File (Rotating)
const errorRotateFile = new transports.DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '5m',
    maxFiles: '14d',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileFormat
    )
});

// 🗂 Combined Log File (Rotating)
const combinedRotateFile = new transports.DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '5m',
    maxFiles: '14d',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileFormat
    )
});

// 🧠 Main Winston Logger
const logger = createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileFormat
    ),
    defaultMeta: { service: 'verifier-api' },
    transports: [
        new transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                emojiFormat
            )
        }),
        errorRotateFile,
        combinedRotateFile
    ],
    exitOnError: false
});

// ➕ Optional stream for morgan logging
interface CustomLogger extends Omit<Logger, 'stream'> {
    stream?: { write(message: string): void };
}

const customLogger = logger as unknown as CustomLogger;
customLogger.stream = {
    write: (message: string) => {
        logger.info(message.trim());
    }
};

export default customLogger;
