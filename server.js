// Epileptic.lua - Authentication Server API
// Для хостинга на Render.com (бесплатный тариф)
// 
// Инструкция:
// 1. Создай аккаунт на https://render.com
// 2. Создай новый Web Service
// 3. Подключи GitHub репозиторий с этим файлом
// 4. Render автоматически запустит сервер

const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// ============================================
// НАСТРОЙКИ
// ============================================

// Пароль для админ-панели (ИЗМЕНИ!)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_ME_TO_SECRET';

// Ключ шифрования скрипта (отдаётся клиенту после активации)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'mybrotherfromanothermother2026keyez4ence';

// База данных ключей (in-memory)
// Формат: "КЛЮЧ": { hwid: null, expiresAt: Date, createdAt: Date, plan: "string" }
const keysDatabase = {};

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

// Точное оставшееся время: дни, часы, минуты, секунды
function getTimeLeft(expiresAt) {
    if (!expiresAt) return { days: "Lifetime", hours: 0, minutes: 0, seconds: 0, total_seconds: null };
    const now = new Date();
    const exp = new Date(expiresAt);
    const diff = exp - now;
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, total_seconds: 0 };
    
    const total_seconds = Math.floor(diff / 1000);
    const days = Math.floor(total_seconds / 86400);
    const hours = Math.floor((total_seconds % 86400) / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    const seconds = total_seconds % 60;
    
    return { days, hours, minutes, seconds, total_seconds };
}

function isKeyExpired(keyData) {
    if (!keyData.expiresAt) return false;
    return new Date(keyData.expiresAt) < new Date();
}

// ============================================
// API ЭНДПОИНТЫ
// ============================================

// Проверка работоспособности
app.get('/', (req, res) => {
    res.json({
        status: "ok",
        service: "Epileptic.lua Auth Server",
        version: "2.0.0",
        keys_count: Object.keys(keysDatabase).length
    });
});

// Отдача картинки для watermark
app.get('/api/watermark.png', (req, res) => {
    // Здесь можно вернуть реальную картинку
    // Пока возвращаем placeholder - замени на свою картинку
    const fs = require('fs');
    const path = require('path');
    const imgPath = path.join(__dirname, 'watermark.png');
    
    if (fs.existsSync(imgPath)) {
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(imgPath);
    } else {
        // Placeholder - 1x1 transparent pixel
        res.setHeader('Content-Type', 'image/png');
        res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    }
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
    
    const keyData = keysDatabase[key];
    
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
    
    // Активируем ключ
    keyData.hwid = hwid;
    
    const daysLeft = getDaysLeft(keyData.expiresAt);
    const timeLeft = getTimeLeft(keyData.expiresAt);
    
    res.json({
        success: true,
        message: daysLeft === "Lifetime" ? "Активирован! Вечный доступ." : `Активирован! Осталось: ${timeLeft.days}д ${timeLeft.hours}ч ${timeLeft.minutes}м`,
        plan: keyData.plan,
        days_left: daysLeft,
        time_left: timeLeft,  // Точное время: days, hours, minutes, seconds, total_seconds
        expires_at: keyData.expiresAt,
        hwid: hwid,
        encryption_key: ENCRYPTION_KEY  // Отдаём ключ шифрования после успешной активации
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
    
    const keyData = keysDatabase[key];
    
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
    
    const daysLeft = getDaysLeft(keyData.expiresAt);
    const timeLeft = getTimeLeft(keyData.expiresAt);
    
    res.json({
        success: true,
        valid: true,
        plan: keyData.plan,
        days_left: daysLeft,
        time_left: timeLeft,  // Точное время: days, hours, minutes, seconds, total_seconds
        expires_at: keyData.expiresAt,
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
        '30sec':  { ms: 30 * 1000,           prefix: 'EPIL-TEST-30S' },
        '1day':   { ms: 1 * 24 * 60 * 60 * 1000, prefix: 'EPIL-TEST-1D' },
        '30day':  { ms: 30 * 24 * 60 * 60 * 1000, prefix: 'EPIL-30D' },
        '90day':  { ms: 90 * 24 * 60 * 60 * 1000, prefix: 'EPIL-90D' },
        'lifetime': { ms: null, prefix: 'EPIL-LT' }
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
    
    for (let i = 0; i < keyCount; i++) {
        const keyNum = Math.random().toString(36).substring(2, 8).toUpperCase();
        const key = `${cfg.prefix}-${keyNum}`;
        
        keysDatabase[key] = {
            hwid: null,
            expiresAt: cfg.ms ? new Date(Date.now() + cfg.ms) : null,
            createdAt: new Date(),
            plan: plan
        };
        
        generatedKeys.push(key);
    }
    
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
    
    const keysList = {};
    for (const [key, data] of Object.entries(keysDatabase)) {
        keysList[key] = {
            hwid: data.hwid,
            plan: data.plan,
            days_left: getDaysLeft(data.expiresAt),
            time_left: getTimeLeft(data.expiresAt),  // Точное время
            expires_at: data.expiresAt,
            created_at: data.createdAt
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
    if (keysDatabase[key]) {
        delete keysDatabase[key];
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
    
    const count = Object.keys(keysDatabase).length;
    
    for (const key in keysDatabase) {
        delete keysDatabase[key];
    }
    
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
    
    let resetCount = 0;
    for (const key in keysDatabase) {
        if (keysDatabase[key].hwid !== null) {
            keysDatabase[key].hwid = null;
            resetCount++;
        }
    }
    
    res.json({
        success: true,
        message: `HWID сброшен у ${resetCount} ключей`,
        reset_count: resetCount
    });
});


const fs = require('fs');
const path = require('path');

app.get('/api/get_script', (req, res) => {
    // 1. Проверяем секретный заголовок (браузер его не отправляет)
    const source = req.headers['x-requested-from'];
    if (source !== 'EpilepticLoader') {
        return res.status(403).send('Access denied: browser requests not allowed');
    }

    // 2. Проверяем, что переданы key и hwid
    const { key, hwid } = req.query;
    if (!key || !hwid) {
        return res.status(400).json({ error: 'Missing key or hwid' });
    }

    // 3. Валидируем ключ в базе
    const keyData = keysDatabase[key];
    if (!keyData) {
        return res.status(403).json({ error: 'Invalid key' });
    }

    // 4. Проверяем, что HWID совпадает (если ключ уже активирован)
    if (keyData.hwid && keyData.hwid !== hwid) {
        return res.status(403).json({ error: 'Key not activated for this HWID' });
    }

    // 5. Проверяем, не истёк ли ключ
    if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
        return res.status(403).json({ error: 'Key expired' });
    }

    // 6. Всё ок – отдаём скрипт
    const filePath = path.join(__dirname, 'script.enc');
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error('Script file missing:', err);
            return res.status(404).json({ error: 'Script not found on server' });
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(data);
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Epileptic Auth Server running on port ${PORT}`);
});

