// Epileptic.lua - Authentication Server API
// Для хостинга на Render.com (бесплатный тариф)
// 
// Инструкция:
// 1. Создай аккаунт на https://render.com
// 2. Создай новый Web Service
// 3. Подключи GitHub репозиторий с этим файлом
// 4. Render автоматически запустит сервер
//
// SQLite используется для персистентного хранения ключей
// Ключи сохраняются при перезапуске сервера

const express = require('express');
const app = express();
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

app.use(cors());
app.use(express.json());

// ============================================
// НАСТРОЙКИ
// ============================================

// Пароль для админ-панели (ИЗМЕНИ!)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_ME_TO_SECRET';

// ============================================
// SQLITE БАЗА ДАННЫХ
// ============================================

// Создаём/открываем базу данных
const dbPath = path.join(__dirname, 'epileptic_keys.db');
const db = new Database(dbPath);

// Включаем WAL mode для лучшей производительности
db.pragma('journal_mode = WAL');

// Создаём таблицу если не существует
db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
        key TEXT PRIMARY KEY,
        hwid TEXT DEFAULT NULL,
        expires_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        plan TEXT NOT NULL
    )
`);

// Индекс для быстрого поиска
db.exec(`CREATE INDEX IF NOT EXISTS idx_keys_key ON keys(key)`);

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getDaysLeft(expiresAt) {
    if (!expiresAt) return "Lifetime";
    const now = new Date();
    const exp = new Date(expiresAt);
    const diff = exp - now;
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isKeyExpired(keyData) {
    if (!keyData.expires_at) return false;
    return new Date(keyData.expires_at) < new Date();
}

function getKeyData(key) {
    const stmt = db.prepare('SELECT * FROM keys WHERE key = ?');
    return stmt.get(key);
}

// ============================================
// API ЭНДПОИНТЫ
// ============================================

// Проверка работоспособности
app.get('/', (req, res) => {
    res.json({
        status: "ok",
        service: "Epileptic.lua Auth Server",
        version: "2.1.0 (SQLite)",
        keys_count: db.prepare('SELECT COUNT(*) as count FROM keys').get().count
    });
});

// Активация ключа
app.post('/api/activate', (req, res) => {
    const { key, hwid, version } = req.body;
    
    if (!key || !hwid) {
        return res.status(400).json({
            success: false,
            error_code: "MISSING_PARAMS",
            message: "Нужно указать key и hwid"
        });
    }
    
    const keyData = getKeyData(key);
    
    if (!keyData) {
        return res.status(400).json({
            success: false,
            error_code: "INVALID_KEY",
            message: "Неверный ключ активации"
        });
    }
    
    // Ключ уже активирован на другом ПК
    if (keyData.hwid && keyData.hwid !== hwid) {
        return res.status(400).json({
            success: false,
            error_code: "KEY_ALREADY_USED",
            message: "Ключ уже активирован на другом компьютере"
        });
    }
    
    // Ключ истёк
    if (isKeyExpired(keyData)) {
        return res.status(400).json({
            success: false,
            error_code: "KEY_EXPIRED",
            message: "Срок действия ключа истёк"
        });
    }
    
    // Активируем ключ (сохраняем HWID)
    const stmt = db.prepare('UPDATE keys SET hwid = ? WHERE key = ?');
    stmt.run(hwid, key);
    
    const daysLeft = getDaysLeft(keyData.expires_at);
    
    res.json({
        success: true,
        message: daysLeft === "Lifetime" ? "Активирован! Вечный доступ." : `Активирован! Осталось дней: ${daysLeft}`,
        plan: keyData.plan,
        days_left: daysLeft,
        expires_at: keyData.expires_at,
        hwid: hwid
    });
});

// Проверка статуса ключа
app.get('/api/check', (req, res) => {
    const { key, hwid } = req.query;
    
    if (!key || !hwid) {
        return res.status(400).json({
            success: false,
            error_code: "MISSING_PARAMS",
            message: "Нужно указать key и hwid"
        });
    }
    
    const keyData = getKeyData(key);
    
    if (!keyData) {
        return res.status(404).json({
            success: false,
            error_code: "KEY_NOT_FOUND",
            message: "Ключ не найден"
        });
    }
    
    if (keyData.hwid !== hwid) {
        return res.status(403).json({
            success: false,
            error_code: "HWID_MISMATCH",
            message: "Ключ не активирован на этом ПК"
        });
    }
    
    if (isKeyExpired(keyData)) {
        return res.status(400).json({
            success: false,
            error_code: "KEY_EXPIRED",
            message: "Ключ истёк"
        });
    }
    
    const daysLeft = getDaysLeft(keyData.expires_at);
    
    res.json({
        success: true,
        valid: true,
        plan: keyData.plan,
        days_left: daysLeft,
        expires_at: keyData.expires_at,
        hwid: keyData.hwid
    });
});

// Админ: генерация ключей
app.post('/api/admin/generate', (req, res) => {
    const { plan, count } = req.body;
    const auth = req.headers['x-admin-key'] || req.headers['authorization'];
    
    if (auth !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Неверный пароль администратора"
        });
    }
    
    const planConfig = {
        '30day': { days: 30, prefix: 'EPIL-30D' },
        '90day': { days: 90, prefix: 'EPIL-90D' },
        'lifetime': { days: null, prefix: 'EPIL-LT' }
    };
    
    const cfg = planConfig[plan];
    if (!cfg) {
        return res.status(400).json({
            success: false,
            message: "Неверный план. Используй: 30day, 90day, lifetime"
        });
    }
    
    const generatedKeys = [];
    const keyCount = count || 1;
    
    const insertStmt = db.prepare(`
        INSERT INTO keys (key, hwid, expires_at, created_at, plan)
        VALUES (?, NULL, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((keys) => {
        for (const k of keys) {
            insertStmt.run(k.key, k.expiresAt, k.createdAt, k.plan);
        }
    });
    
    const newKeys = [];
    for (let i = 0; i < keyCount; i++) {
        const keyNum = Math.random().toString(36).substring(2, 8).toUpperCase();
        const key = `${cfg.prefix}-${keyNum}`;
        const expiresAt = cfg.days ? new Date(Date.now() + cfg.days * 24 * 60 * 60 * 1000).toISOString() : null;
        const createdAt = new Date().toISOString();
        
        newKeys.push({ key, expiresAt, createdAt, plan });
        generatedKeys.push(key);
    }
    
    insertMany(newKeys);
    
    res.json({
        success: true,
        keys: generatedKeys,
        plan: plan,
        count: keyCount
    });
});

// Админ: список всех ключей
app.get('/api/admin/keys', (req, res) => {
    const auth = req.headers['x-admin-key'] || req.headers['authorization'];
    
    if (auth !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Неверный пароль администратора"
        });
    }
    
    const allKeys = db.prepare('SELECT * FROM keys').all();
    
    const keysList = {};
    for (const row of allKeys) {
        keysList[row.key] = {
            hwid: row.hwid,
            plan: row.plan,
            days_left: getDaysLeft(row.expires_at),
            expires_at: row.expires_at,
            created_at: row.created_at
        };
    }
    
    res.json({
        success: true,
        keys: keysList,
        total: Object.keys(keysList).length
    });
});

// Админ: удалить ключ
app.delete('/api/admin/key/:key', (req, res) => {
    const auth = req.headers['x-admin-key'] || req.headers['authorization'];
    
    if (auth !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Неверный пароль администратора"
        });
    }
    
    const key = req.params.key;
    const stmt = db.prepare('DELETE FROM keys WHERE key = ?');
    const result = stmt.run(key);
    
    if (result.changes > 0) {
        res.json({ success: true, message: `Ключ ${key} удалён` });
    } else {
        res.status(404).json({ success: false, message: "Ключ не найден" });
    }
});

// Админ: удалить ВСЕ ключи
app.post('/api/admin/wipe-all', (req, res) => {
    const auth = req.headers['x-admin-key'] || req.headers['authorization'];
    
    if (auth !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Неверный пароль администратора"
        });
    }
    
    const count = db.prepare('SELECT COUNT(*) as count FROM keys').get().count;
    
    db.exec('DELETE FROM keys');
    
    res.json({
        success: true,
        message: "Все ключи удалены",
        deleted_count: count
    });
});

// Админ: сбросить HWID у всех ключей
app.post('/api/admin/reset-hwids', (req, res) => {
    const auth = req.headers['x-admin-key'] || req.headers['authorization'];
    
    if (auth !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Неверный пароль администратора"
        });
    }
    
    const result = db.exec('UPDATE keys SET hwid = NULL WHERE hwid IS NOT NULL');
    const resetCount = result[0]?.changes || 0;
    
    res.json({
        success: true,
        message: `HWID сброшен у ${resetCount} ключей`,
        reset_count: resetCount
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const keyCount = db.prepare('SELECT COUNT(*) as count FROM keys').get().count;
    console.log(`Epileptic Auth Server running on port ${PORT}`);
    console.log(`SQLite database: ${dbPath}`);
    console.log(`Keys in database: ${keyCount}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    console.log('Database connection closed');
    process.exit(0);
});
