import React, { useEffect, useRef } from 'react';

export default function TurnstileWidget({ onVerify, onExpire, onError }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    let active = true;

    const renderWidget = () => {
      if (!window.turnstile || !containerRef.current || widgetIdRef.current) return;

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: '0x4AAAAAAB7R_--firW0k1YT',
          theme: 'dark',
          callback: (token) => {
            if (active) onVerify(token);
          },
          'expired-callback': () => {
            if (active) {
              widgetIdRef.current = null;
              if (onExpire) onExpire();
            }
          },
          'error-callback': (err) => {
            if (active && onError) onError(err);
          }
        });
      } catch (err) {
        console.error('Turnstile render failed:', err);
      }
    };

    // Poll until the Turnstile library is fully loaded and available in global window scope
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        renderWidget();
      }
    }, 100);

    return () => {
      active = false;
      clearInterval(interval);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (e) {}
      }
    };
  }, [onVerify, onExpire, onError]);

  return (
    <div className="flex flex-col items-center justify-center my-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div ref={containerRef} className="cf-turnstile" />
      {!window.turnstile && (
        <p className="text-slate-500 text-xs mt-2 animate-pulse">
          Loading security check... (If this persists, disable your ad-blocker/shields for localhost)
        </p>
      )}
    </div>
  );
}
