// Stops in-page translators from crashing React.
//
// Chrome's built-in Google Translate (offered automatically on Android) swaps
// the text nodes React rendered for its own <font> wrappers. When React later
// unmounts or reorders that content, it calls removeChild/insertBefore with a
// node whose parent the translator changed, the browser throws NotFoundError,
// and the whole app drops to the ErrorBoundary screen. That is
// JAVASCRIPT-REACT-1Z (2026-11-14, Chrome Mobile / Android, home page), and a
// known React issue (facebook/react#11538) with no fix inside React itself.
//
// We don't set translate="no": students reading in another language are
// exactly who should be able to translate the page. Instead, the two DOM calls
// React uses skip the impossible case (the node isn't a child of this parent)
// instead of throwing. Every valid call goes through untouched. A console
// warning leaves a Sentry breadcrumb if this ever hides something else.

export function installDomResilience(NodeCtor = typeof Node === 'function' ? Node : undefined) {
  const proto = NodeCtor?.prototype
  if (!proto || proto.__ckDomResilience) return false

  const originalRemoveChild = proto.removeChild
  proto.removeChild = function removeChild(child) {
    if (child && child.parentNode !== this) {
      console.warn('[dom] removeChild skipped: node is not a child of this parent (page translator?)')
      return child
    }
    return originalRemoveChild.call(this, child)
  }

  const originalInsertBefore = proto.insertBefore
  proto.insertBefore = function insertBefore(newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.warn('[dom] insertBefore skipped: reference node is not a child of this parent (page translator?)')
      return newNode
    }
    return originalInsertBefore.call(this, newNode, referenceNode)
  }

  Object.defineProperty(proto, '__ckDomResilience', { value: true })
  return true
}
