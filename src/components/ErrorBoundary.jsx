import { Component } from 'react'
import * as Sentry from '@sentry/react'

export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--cream, #F5F2EC)',
          padding: '2rem',
        }}>
          <div role="alert" aria-live="assertive" style={{ textAlign: 'center', maxWidth: 360 }}>
            <div aria-hidden="true" style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>&#9888;</div>
            <h2 style={{
              fontFamily: "var(--font-display, 'Playfair Display', Georgia, serif)",
              fontSize: '1.75rem',
              fontWeight: 400,
              color: 'var(--navy, #0A1929)',
              marginBottom: '0.5rem',
            }}>
              Something went wrong
            </h2>
            <p style={{
              color: 'var(--text-muted, #6B7583)',
              fontSize: '0.95rem',
              lineHeight: 1.6,
              marginBottom: '1.5rem',
            }}>
              Oops, something unexpected happened. Let's get you back on track.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false })
                window.location.href = '/'
              }}
              style={{
                background: 'var(--navy, #0A1929)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.95rem',
                padding: '0.7rem 2rem',
                borderRadius: 'var(--radius-md, 10px)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Restart app
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
