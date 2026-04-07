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
          background: '#fbf7f9',
          padding: '2rem',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 360 }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>&#9888;</div>
            <h2 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '1.75rem',
              fontWeight: 400,
              color: '#2a1638',
              marginBottom: '0.5rem',
            }}>
              Something went wrong
            </h2>
            <p style={{
              color: '#8a7090',
              fontSize: '0.95rem',
              lineHeight: 1.6,
              marginBottom: '1.5rem',
            }}>
              The app ran into an unexpected error. Restarting should fix it.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false })
                window.location.href = '/'
              }}
              style={{
                background: '#6b3d8f',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.95rem',
                padding: '0.7rem 2rem',
                borderRadius: 8,
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
