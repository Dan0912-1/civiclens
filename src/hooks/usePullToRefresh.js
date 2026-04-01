import { useState, useEffect, useRef } from 'react'

/**
 * Pull-to-refresh hook for native-feel refresh on scroll pages.
 * Returns { refreshing, pullProgress, containerProps } where containerProps
 * should be spread on the scrollable container.
 *
 * @param {Function} onRefresh — async function to call when refresh triggers
 * @param {Object} options — { threshold: pixels to pull (default 80) }
 */
export default function usePullToRefresh(onRefresh, { threshold = 80 } = {}) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullProgress, setPullProgress] = useState(0)
  const startY = useRef(0)
  const pulling = useRef(false)

  useEffect(() => {
    function onTouchStart(e) {
      if (window.scrollY > 0 || refreshing) return
      startY.current = e.touches[0].clientY
      pulling.current = true
    }

    function onTouchMove(e) {
      if (!pulling.current || refreshing) return
      const delta = e.touches[0].clientY - startY.current
      if (delta < 0) {
        setPullProgress(0)
        return
      }
      setPullProgress(Math.min(delta / threshold, 1))
    }

    async function onTouchEnd() {
      if (!pulling.current) return
      pulling.current = false
      if (pullProgress >= 1 && !refreshing) {
        setRefreshing(true)
        setPullProgress(0)
        try {
          await onRefresh()
        } finally {
          setRefreshing(false)
        }
      } else {
        setPullProgress(0)
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onRefresh, refreshing, pullProgress, threshold])

  return { refreshing, pullProgress }
}
