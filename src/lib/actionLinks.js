export function splitActionText(text = '') {
  return String(text).split(/(https?:\/\/[^\s,)]+)/g).map(part => {
    if (!/^https?:\/\//i.test(part)) return { text: part, href: null, trailing: '' }
    const href = part.replace(/[.,;:!?]+$/, '')
    return { text: href, href, trailing: part.slice(href.length) }
  })
}
