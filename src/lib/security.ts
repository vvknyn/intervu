import AES from 'crypto-js/aes';
import encUtf8 from 'crypto-js/enc-utf8';

/**
 * Security utility handling client-side encryption.
 * 
 * NOTE: Client-side encryption key is accessible to the client.
 * This primarily protects against:
 * 1. Casual snooping (someone looking at localStorage)
 * 2. Automated malware scanning for key patterns (e.g. "sk-...")
 * 3. XSS scripts that blindly exfiltrate storage without decryption logic
 */

// Use a fallback key if env var is missing, but warn in console
const ENCRYPTION_KEY = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || 'intervu-secure-fallback-key-change-me';

if (!process.env.NEXT_PUBLIC_ENCRYPTION_KEY) {
    console.warn("[Security] NEXT_PUBLIC_ENCRYPTION_KEY not set. Using fallback key. Please add to .env");
}

export const SecurityUtils = {
    /**
     * Encrypts a string value
     */
    encrypt: (value: string): string => {
        try {
            if (!value) return '';
            return AES.encrypt(value, ENCRYPTION_KEY).toString();
        } catch (e) {
            console.error("[Security] Encryption failed", e);
            return value;
        }
    },

    /**
     * Decrypts a string value
     */
    decrypt: (value: string): string => {
        try {
            if (!value) return '';
            const bytes = AES.decrypt(value, ENCRYPTION_KEY);
            return bytes.toString(encUtf8);
        } catch (e) {
            // If decryption fails (e.g. old unencrypted data), return original (best effort)
            // console.warn("[Security] Decryption failed, returning raw value");
            return value;
        }
    }
};

/**
 * Wrapper for localStorage that transparently encrypts specific keys
 */
export const SecureStorage = {
    /**
     * Set an item with automatic encryption for sensitive keys
     */
    setItem: (key: string, value: string) => {
        if (typeof window === 'undefined') return;

        let valueToStore = value;
        // List of keys requiring encryption
        const SENSITIVE_KEYS = ['guest_api_keys', 'openai_key', 'anthropic_key', 'groq_key'];

        if (SENSITIVE_KEYS.some(k => key.includes(k))) {
            valueToStore = SecurityUtils.encrypt(value);
        }

        try {
            localStorage.setItem(key, valueToStore);
        } catch (e) {
            console.error("Storage quota exceeded or unavailable", e);
        }
    },

    /**
     * Get an item with automatic decryption
     */
    getItem: (key: string): string | null => {
        if (typeof window === 'undefined') return null;

        const value = localStorage.getItem(key);
        if (!value) return null;

        const SENSITIVE_KEYS = ['guest_api_keys', 'openai_key', 'anthropic_key', 'groq_key'];

        if (SENSITIVE_KEYS.some(k => key.includes(k))) {
            const decrypted = SecurityUtils.decrypt(value);
            // If decrypt returns empty string but original was not, it might have failed.
            // But if it was successfully decrypted, return that.
            // Check if it looks like original was encrypted (AES format U2F...)
            // Simple heuristic: if decrypted is empty and value was long, maybe failure?
            // For now rely on SecurityUtils returning empty string on error or original?
            // My SecurityUtils currently strictly tries to decrypt.

            // Handle legacy unencrypted data:
            if (!decrypted && value.length > 0) return value; // Fallback to raw if logic fails?
            return decrypted;
        }

        return value;
    },

    removeItem: (key: string) => {
        if (typeof window === 'undefined') return;
        localStorage.removeItem(key);
    },

    clear: () => {
        if (typeof window === 'undefined') return;
        localStorage.clear();
    }
};
