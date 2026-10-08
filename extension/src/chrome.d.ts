/**
 * The few Chrome extension APIs this extension calls, typed by hand so the
 * repo's `tsc --noEmit` checks the extension without adding @types/chrome.
 * Shapes follow developer.chrome.com/docs/extensions/reference.
 */
declare namespace chrome {
    namespace tabs {
        interface Tab {
            id?: number;
            windowId: number;
            title?: string;
            url?: string;
        }
        function create(props: { url: string }): Promise<Tab>;
    }
    namespace scripting {
        interface InjectionResult<T> {
            result?: T;
        }
        function executeScript<T>(injection: { target: { tabId: number }; func: () => T }): Promise<InjectionResult<T>[]>;
    }
    namespace action {
        const onClicked: { addListener(cb: (tab: tabs.Tab) => void): void };
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
        const onClicked: { addListener(cb: (info: OnClickData, tab?: tabs.Tab) => void): void };
    }
    namespace runtime {
        const onInstalled: { addListener(cb: () => void): void };
    }
    namespace storage {
        interface StorageChange {
            oldValue?: unknown;
            newValue?: unknown;
        }
        interface StorageArea {
            get(key: string): Promise<Record<string, unknown>>;
            set(items: Record<string, unknown>): Promise<void>;
        }
        const session: StorageArea;
        const onChanged: {
            addListener(cb: (changes: Record<string, StorageChange>, areaName: string) => void): void;
        };
    }
}
