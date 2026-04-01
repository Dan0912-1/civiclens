import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{
          minHeight: 'calc(100vh - 64px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#faf9f6',
        }}>
          <div style={{
            textAlign: 'center',
            maxWidth: '400px',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#9878;</div>
            <h1 style={{
              fontSize: '1.5rem',
              color: '#0d1b2a',
              marginBottom: '0.75rem',
              fontFamily: 'Playfair Display, serif',
            }}>
              Something went wrong
            </h1>
            <p style={{
              color: '#6b7280',
              fontSize: '0.95rem',
              lineHeight: '1.6',
              marginBottom: '1.5rem',
            }}>
              GovDecoded ran into an unexpected problem. Try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#0d1b2a',
                color: '#fff',
                padding: '0.7rem 1.5rem',
                borderRadius: '8px',
                fontWeight: '600',
                fontSize: '0.9rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Refresh page
            </button>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}
