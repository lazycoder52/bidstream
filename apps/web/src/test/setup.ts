import '@testing-library/jest-dom';

const OriginalRequest = globalThis.Request;
if (OriginalRequest) {
  // Wrap Request to handle JSDOM / Node 22 AbortSignal discrepancy gracefully
  class WrappedRequest extends OriginalRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init && init.signal) {
        try {
          super(input, init);
        } catch {
          // If signal fails instanceof check, construct without signal
          const { signal: _, ...rest } = init;
          super(input, rest);
        }
      } else {
        super(input, init);
      }
    }
  }

  globalThis.Request = WrappedRequest as unknown as typeof Request;
  window.Request = WrappedRequest as unknown as typeof Request;
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

window.scrollTo = () => {};
