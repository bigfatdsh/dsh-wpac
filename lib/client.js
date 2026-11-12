// wpac 结构确认弹窗（浏览器半边）。
// 只由 wpac 的 wpac_structure_review 工具触发：轮询 /dsh-wpac-review，有 pending 就弹。
window.__ModuleLoader__.load({
  id: 'dsh-wpac',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    let state = { open: false, review: null }
    const subs = new Set()
    const emit = () => { for (const fn of subs) fn(state) }
    const openReview = (review) => { state = { open: true, review }; emit() }
    const closeReview = () => { state = { open: false, review: null }; emit() }
    const useStore = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const fn = () => force((n) => n + 1)
        subs.add(fn)
        return () => subs.delete(fn)
      }, [])
      return state
    }

    const CSS = `
.wpac-rv-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(15,18,26,.42);display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.wpac-rv-modal{width:min(980px,94vw);height:min(660px,88vh);display:flex;flex-direction:column;overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-elevated,#fff);border:1px solid var(--dsw-alias-border-l1,#e3e7ee);box-shadow:0 24px 80px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary,#111827);font-size:13px}
.wpac-rv-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,#e9edf3)}
.wpac-rv-title{font-size:16px;font-weight:600;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpac-rv-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);margin-left:8px;font-weight:400}
.wpac-rv-x{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:20px;line-height:1;cursor:pointer}
.wpac-rv-x:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.05))}
.wpac-rv-body{flex:1;display:flex;min-height:0}
.wpac-rv-left{width:320px;flex:0 0 320px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1,#e9edf3);padding:16px;gap:10px;background:var(--dsw-alias-bg-base,#fafbfc)}
.wpac-rv-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280);font-weight:500}
.wpac-rv-list{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:96px;max-height:220px}
.wpac-rv-item{display:flex;flex-direction:column;gap:3px;text-align:left;padding:9px 11px;border-radius:8px;border:1px solid transparent;background:transparent;cursor:pointer;color:inherit;font-family:inherit}
.wpac-rv-item:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.04))}
.wpac-rv-item[data-on="1"]{border-color:var(--dsw-alias-border-l1,#c9d3e3);background:var(--dsw-alias-bg-selected,rgba(37,99,235,.08))}
.wpac-rv-item b{font-size:13px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpac-rv-item span{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpac-rv-ta{flex:1;min-height:104px;resize:none;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#d8dde5);background:var(--dsw-alias-bg-elevated,#fff);color:inherit;padding:9px 11px;font-size:13px;line-height:20px;font-family:inherit;outline:none}
.wpac-rv-ta:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.14)}
.wpac-rv-confirm{height:42px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.wpac-rv-confirm:disabled{background:#b9c8e8;cursor:not-allowed}
.wpac-rv-right{flex:1;min-width:0;overflow:auto;padding:18px}
.wpac-rv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.wpac-rv-card{border:1px solid var(--dsw-alias-border-l1,#e3e7ee);border-radius:10px;padding:13px;background:var(--dsw-alias-bg-base,#fafbfc);cursor:pointer;min-width:0}
.wpac-rv-card[data-on="1"]{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.14)}
.wpac-rv-card b{display:block;font-size:13px;line-height:18px;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpac-rv-card p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.wpac-rv-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(17,24,39,.92);color:#fff;font-size:13px;line-height:18px;padding:9px 16px;border-radius:8px;z-index:2147483001;pointer-events:none}
`
    if (!document.getElementById('wpac-rv-style')) {
      const style = document.createElement('style')
      style.id = 'wpac-rv-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    let toast = null
    const toastBox = (text) => text ? h('div', { className: 'wpac-rv-toast' }, text) : null
    const showToast = (text) => { toast = text; emit(); setTimeout(() => { toast = null; emit() }, 1600) }

    function ModuleButton({ m, i, on, onPick }) {
      return h('button', {
        type: 'button', className: 'wpac-rv-item', 'data-on': on ? '1' : '0',
        onClick: () => onPick(m.id || String(i)),
      }, h('b', null, m.title || ('模块 ' + (i + 1))), h('span', null, m.role || ''))
    }

    function ModuleCard({ m, i, on, onPick }) {
      return h('div', {
        className: 'wpac-rv-card', 'data-on': on ? '1' : '0',
        onClick: () => onPick(m.id || String(i)),
      }, h('b', null, m.title || ('模块 ' + (i + 1))), h('p', null, m.summary || m.role || ''))
    }

    function ReviewModal({ review }) {
      const [selected, setSelected] = React.useState(null)
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const modules = Array.isArray(review.modules) ? review.modules : []
      const pick = (id) => setSelected((cur) => (cur === id ? null : id))
      const send = async (action) => {
        if (action === 'confirm') {
          const id = selected || (modules[0] && modules[0].id) || ''
          if (!text.trim()) return
          const feedback = [{ moduleId: id, instruction: text.trim() }]
          setBusy(true)
          try {
            await fetch('/dsh-wpac-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: review.id, action, feedback }) })
            closeReview()
            showToast('已提交，模型会按意见改这一段')
          } catch { showToast('提交失败，请重试') } finally { setBusy(false) }
          return
        }
        try { await fetch('/dsh-wpac-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: review.id, action: 'cancel', feedback: [] }) }) } catch { /* ignore */ }
        closeReview()
      }
      const left = h('aside', { className: 'wpac-rv-left' },
        h('div', { className: 'wpac-rv-label' }, '模块（点一下选中）'),
        h('div', { className: 'wpac-rv-list' }, modules.map((m, i) => h(ModuleButton, {
          key: m.id || i, m, i, on: selected === (m.id || String(i)), onPick: pick,
        }))),
        h('div', { className: 'wpac-rv-label' }, '修改意见'),
        h('textarea', {
          className: 'wpac-rv-ta', value: text,
          placeholder: '比如：把结尾改成一句平话，不要升华；这一段写具体一点。',
          onChange: (e) => setText(e.target.value),
        }),
        h('button', { className: 'wpac-rv-confirm', type: 'button', disabled: busy || !text.trim(), onClick: () => send('confirm') }, busy ? '提交中…' : '确认修改'),
      )
      const right = h('section', { className: 'wpac-rv-right' },
        h('div', { className: 'wpac-rv-grid' }, modules.map((m, i) => h(ModuleCard, {
          key: m.id || i, m, i, on: selected === (m.id || String(i)), onPick: pick,
        }))),
      )
      return h('div', {
        className: 'wpac-rv-backdrop',
        onMouseDown: (e) => { if (e.target === e.currentTarget) send('cancel') },
      },
        h('div', { className: 'wpac-rv-modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'wpac-rv-head' },
            h('div', { className: 'wpac-rv-title' }, review.title || '结构确认',
              h('span', { className: 'wpac-rv-sub' }, review.kind || '任务')),
            h('button', { className: 'wpac-rv-x', type: 'button', 'aria-label': '关闭', onClick: () => send('cancel') }, '×'),
          ),
          h('div', { className: 'wpac-rv-body' }, left, right),
        ),
        toastBox(toast),
      )
    }

    function ReviewHost() {
      const s = useStore()
      return h(React.Fragment, null, s.open && s.review ? h(ReviewModal, { review: s.review }) : null,
        s.open ? null : toastBox(toast))
    }

    function poll() {
      if (!state.open) {
        fetch('/dsh-wpac-review', { cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => { if (d && d.ok && d.review && d.review.id) openReview(d.review) })
          .catch(() => {})
      }
      setTimeout(poll, 1500)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'wpac-review-host', order: 90,
        }, ReviewHost))
        poll()
      },
    }
  },
})
