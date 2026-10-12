/**
 * The few Chrome extension APIs this extension calls, typed by hand so the
 * repo's `tsc --noEmit` checks the extension without adding @types/chrome.
 * Shapes follow developer.chrome.com/docs/extensions/reference.
 */
declare namespace chrome {
    interface Event<T extends (...args: never[]) => unknown> {
        addListener(cb: T): void;
        removeListener(cb: T): void;
    }
    namespace tabs {
        interface Tab {
            id?: number;
            windowId: number;
            title?: string;
            url?: string;
            active?: boolean;
        }
        interface ChangeInfo {
            status?: string;
            url?: string;
        }
        function create(props: { url: string; active?: boolean }): Promise<Tab>;
        function get(tabId: number): Promise<Tab>;
        function query(props: { active?: boolean; currentWindow?: boolean; windowId?: number }): Promise<Tab[]>;
        function update(tabId: number, props: { active?: boolean; url?: string }): Promise<Tab>;
        const onUpdated: Event<(tabId: number, changeInfo: ChangeInfo, tab: Tab) => void>;
        const onRemoved: Event<(tabId: number) => void>;
    }
    namespace windows {
        interface Window {
            id?: number;
            tabs?: tabs.Tab[];
        }
        function create(props: { url: string; type?: "normal" | "popup"; width?: number; height?: number; focused?: boolean }): Promise<Window>;
        function get(windowId: number): Promise<Window>;
        function remove(windowId: number): Promise<void>;
        function update(windowId: number, props: { focused?: boolean }): Promise<Window>;
        const onRemoved: Event<(windowId: number) => void>;
    }
    namespace scripting {
        interface InjectionResult<T> {
            result?: T;
        }
        function executeScript<T>(injection: { target: { tabId: number }; func: () => T }): Promise<InjectionResult<T>[]>;
        function executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<InjectionResult<unknown>[]>;
        interface RegisteredContentScript {
            id: string;
            matches?: string[];
            excludeMatches?: string[];
            js?: string[];
            runAt?: "document_start" | "document_end" | "document_idle";
            persistAcrossSessions?: boolean;
        }
        function registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
        function updateContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
        function unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
        function getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScript[]>;
    }
    namespace action {
        const onClicked: Event<(tab: tabs.Tab) => void>;
    }
    namespace sidePanel {
        function open(options: { windowId?: number; tabId?: number }): Promise<void>;
    }
    namespace contextMenus {
        interface OnClickData {
            menuItemId: string | number;
            selectionText?: string;
            pageUrl?: string;
        }
        function create(props: { id: string; title: string; contexts: string[] }): void;
        const onClicked: Event<(info: OnClickData, tab?: tabs.Tab) => void>;
    }
    namespace permissions {
        interface Permissions {
            origins?: string[];
            permissions?: string[];
        }
        function request(permissions: Permissions): Promise<boolean>;
        function contains(permissions: Permissions): Promise<boolean>;
        function getAll(): Promise<Permissions>;
        function remove(permissions: Permissions): Promise<boolean>;
        const onAdded: Event<(permissions: Permissions) => void>;
        const onRemoved: Event<(permissions: Permissions) => void>;
    }
    namespace runtime {
        interface MessageSender {
            tab?: tabs.Tab;
            url?: string;
        }
        /** Unset once the extension is updated or removed under a running content script. */
        const id: string | undefined;
        const onInstalled: Event<(details: { reason: string }) => void>;
        const onStartup: Event<() => void>;
        const onMessage: Event<(message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void>;
        function sendMessage(message: unknown): Promise<unknown>;
        function getURL(path: string): string;
        function getManifest(): { version: string; content_scripts?: { matches: string[] }[] };
    }
    namespace storage {
        interface StorageChange {
            oldValue?: unknown;
            newValue?: unknown;
        }
        interface StorageArea {
            get(key: string | string[]): Promise<Record<string, unknown>>;
            set(items: Record<string, unknown>): Promise<void>;
            remove(key: string | string[]): Promise<void>;
        }
        const session: StorageArea;
        const local: StorageArea;
        const onChanged: Event<(changes: Record<string, StorageChange>, areaName: string) => void>;
    }
}
