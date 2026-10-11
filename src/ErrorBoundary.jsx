import React from 'react';

export class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg, #0a0a0c)',
          color: 'var(--text, #e8e8ec)',
          zIndex: 9999,
          padding: '20px',
          overflow: 'auto'
        }}>
          <div style={{
            maxWidth: '520px',
            width: '100%',
            background: 'var(--surface, #131317)',
            border: '1px solid var(--border, rgba(255,255,255,0.075))',
            borderRadius: '14px',
            padding: '30px'
          }}>
            <h1 style={{ fontSize: '22px', margin: '0 0 12px' }}>
              Что-то пошло не так
            </h1>
            <p style={{ margin: '0 0 20px', opacity: 0.85, lineHeight: 1.5 }}>
              Попробуйте перезагрузить страницу. Если ошибка повторится — напишите нам.
            </p>
            <details style={{ margin: '12px 0', color: 'var(--text-2, #9ba1ae)', fontSize: '12px' }}>
              <summary>Показать детали</summary>
              <pre style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                maxHeight: '200px',
                overflow: 'auto',
                marginTop: '8px'
              }}>
                {this.state.error && this.state.error.toString()}
                {this.state.errorInfo && this.state.errorInfo.componentStack}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
              <button 
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent, #e9e9ee)',
                  color: 'var(--accent-fg, #111114)',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Перезагрузить
              </button>
              <button 
                onClick={() => window.location.href = '/'}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  color: 'var(--text, #e8e8ec)',
                  border: '1px solid var(--border, rgba(255,255,255,0.075))',
                  borderRadius: '10px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                На главную
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
