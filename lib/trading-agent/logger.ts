import * as fs from 'fs';
import * as path from 'path';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, any>;
}

export class Logger {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
    this.ensureLogDirectory();
  }

  info(message: string, data?: Record<string, any>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, any>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, any>): void {
    this.log('error', message, data);
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    const logString = JSON.stringify(entry);
    if (data === undefined) {
      console.log(`[${level.toUpperCase()}] ${message}`);
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`, data);
    }

    try {
      fs.appendFileSync(this.logPath, logString + '\n', 'utf-8');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }

  private ensureLogDirectory(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  readLogs(level?: 'info' | 'warn' | 'error'): LogEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) {
        return [];
      }

      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      const logs = lines.map(line => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      }).filter((log): log is LogEntry => log !== null);

      if (level) {
        return logs.filter(log => log.level === level);
      }

      return logs;
    } catch (err) {
      console.error('Failed to read log file:', err);
      return [];
    }
  }

  clearLogs(): void {
    try {
      fs.unlinkSync(this.logPath);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }
}
