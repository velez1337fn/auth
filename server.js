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
    
    res.json({
        success: true,
        message: daysLeft === "Lifetime" ? "Активирован! Вечный доступ." : `Активирован! Осталось дней: ${daysLeft}`,
        plan: keyData.plan,
        days_left: daysLeft,
        expires_at: keyData.expiresAt,
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
    
    res.json({
        success: true,
        valid: true,
        plan: keyData.plan,
        days_left: daysLeft,
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

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Epileptic Auth Server running on port ${PORT}`);
});
