// dsh-wpac 结构确认弹窗（浏览器半边）。
//
// 谁调：只有 wpac 预设里的 `wpac_structure_review` 工具会挂出一条 pending。
// 怎么弹：插件注册进 `shell.overlay`（AppFrame 里盖住整个应用的那一层），
//         轮询 /dsh-wpac-review，取到 pending 就铺一层全屏弹窗。
// 怎么回：用户点「确认并修改（n）」→ POST feedback（moduleId + instruction）→
//         工具 resolve，模型按 moduleId 只改那几段；点「确认并交付」= 不加意见。
//
// 布局：左侧 380px 固定（模块列表 + 意见编辑 + 蓝色确认键）；右侧默认是结构总览，
//       点左侧某个模块就切成「这个模块的详细内容」（标题 / 作用 / 摘要 / 正文片段 /
//       待改意见），右上角可以退回总览。
//
// 两条硬约束（别改回去）：
//   1. 只能挂在 shell.overlay。conversation.input.right 是输入框旁边的小格子，
//      弹不出「交付前必须确认」的那种窗。
//   2. 颜色全部走 --dsw-alias-* 令牌（明暗主题自动切），不许写死白底/白字/品牌色；
//      所有单行文本 nowrap + ellipsis、多行 word-break、全链 min-width:0，禁止叠字。
window.__ModuleLoader__.load({
  id: 'dsh-wpac',
  factory(require) {
    // ──────────────────────────────────────────────────────────────
    // 1. 令牌：DSH 设计系统，body[data-ds-dark-theme] 会自动换值
    // ──────────────────────────────────────────────────────────────
    const React = require('react')
    const h = React.createElement

    const T = {
      ink: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      faint: 'var(--dsw-alias-label-tertiary)',
      line: 'var(--dsw-alias-border-l1)',
      line2: 'var(--dsw-alias-border-l2)',
      bg: 'var(--dsw-alias-bg-layer-1)',
      surface: 'color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)',
      surfaceStrong: 'color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)',
      accent: 'var(--dsw-alias-button-info-fill)',
      accentHover: 'var(--dsw-alias-button-info-hover)',
      onAccent: 'var(--dsw-alias-label-on-color, #fff)',
      scrim: 'var(--dsw-alias-bg-mask-3, rgba(0,0,0,.48))',
      tint: 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 10%, transparent)',
      tintLine: 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 26%, transparent)',
    }

    // ──────────────────────────────────────────────────────────────
    // 2. 常量与文案
    // ──────────────────────────────────────────────────────────────
    const ENDPOINT = '/dsh-wpac-review'
    const POLL_MS = 1200
    const TOAST_MS = 2400

    const COPY = {
      title: '结构确认',
      guide: '① 左边点一个模块，右边看这一块的正文　② 想改就写在左下，点「加入意见」　③ 点蓝色按钮：没意见=直接交付，有意见=改完再交',
      selectLabel: '① 选一段 → 右边看正文',
      editorFallback: '② 写修改意见（先在左边选一段）',
      textareaPlaceholder: '比如：这段太像总结，改具体一点；把结尾的升华删掉；顺序改成先写难在哪。',
      addNote: '加入意见',
      addHint: '回车换行 · ⌘/Ctrl+Enter 直接加入',
      confirmEdit: (n) => `确认并修改（${n}）`,
      confirmDeliver: '确认并交付',
      submitting: '提交中…',
      noteDeliverHint: '不加意见 = 结构没问题，点确认即交付',
      noteEditHint: '点确认后模型只改这几段，再自检一次',
      backToOverview: '← 结构总览',
      detailJob: '它干什么',
      detailEdits: '待改意见',
      noModules: '模型没给结构模块',
      emptyModules: '这次没拿到结构模块，可以直接确认交付。',
      submitted: (n) => (n ? '已提交，模型按意见只改这几段' : '结构已确认'),
      cancelled: '已取消，模型不会交付',
      duplicate: '结构和刚确认的一致，已自动确认',
      postFailed: '提交失败，请再点一次',
    }

    // 交付物格式的文案由宿主随 review.display 一起下发（唯一真源在 lib/formats.js）；
    // 这里只留一份兜底，防止连到旧宿主时空白。
    const FALLBACK_META = {
      prose: { tag: '文字稿', struct: '内容结构', unit: '段', body: '这段正文', kicker: '这一段在全文里的位置', job: '它干什么' },
      slides: { tag: 'PPT', struct: '幻灯片结构', unit: '页', body: '这一页的内容', kicker: '这一页在汇报里的位置', job: '这页要讲什么' },
      document: { tag: 'Word/文档', struct: '文档结构', unit: '节', body: '这一节的内容', kicker: '这一节在文档里的位置', job: '这节要写什么' },
      pdf: { tag: 'PDF', struct: 'PDF 结构', unit: '页', body: '这一页的内容', kicker: '这一页在文件里的位置', job: '这页要讲什么' },
      table: { tag: '表格', struct: '表格结构', unit: '块', body: '这一块的内容', kicker: '这一块在表里的位置', job: '这块放什么' },
    }
    const metaOf = (review) => (review && review.display) || FALLBACK_META[review && review.format] || FALLBACK_META.prose

    // ──────────────────────────────────────────────────────────────
    // 3. 纯函数
    // ──────────────────────────────────────────────────────────────
    const asText = (value) => (typeof value === 'string' ? value : '')

    /** 结构指纹：标题 + 类型 + 每块的 id/标题/正文摘要。round 不算，改了内容才算变。 */
    function signatureOf(review) {
      const modules = Array.isArray(review && review.modules) ? review.modules : []
      const body = modules
        .map((m) => [asText(m && m.id), asText(m && m.title), asText(m && m.text).length, asText(m && m.text).slice(0, 60)].join('~'))
        .join('|')
      return [asText(review && review.title), asText(review && review.kind), asText(review && review.format), body].join('#')
    }
    const moduleKey = (m, i) => String((m && (m.id || m.title)) || ('m' + i))
    const moduleTitle = (m, i) => asText(m && m.title) || `模块 ${i + 1}`
    const moduleText = (m) => asText(m && m.text)

    function toNote(module, modules, text) {
      const index = modules.indexOf(module)
      return {
        moduleId: moduleKey(module, index),
        moduleTitle: moduleTitle(module, index),
        instruction: text.slice(0, 2000),
      }
    }

    // ──────────────────────────────────────────────────────────────
    // 4. 样式（全部 inline，不注入全局 CSS）
    // ──────────────────────────────────────────────────────────────
    const S = {
      backdrop: {
        position: 'fixed', inset: 0, zIndex: 2147483000, background: T.scrim,
        backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 24, boxSizing: 'border-box',
        fontFamily: 'inherit', color: T.ink,
      },
      panel: {
        width: 'min(1140px, 100%)', height: 'min(780px, 100%)',
        display: 'flex', flexDirection: 'column', minHeight: 0,
        background: T.bg, borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,.24)', border: `1px solid ${T.line2}`,
      },
      head: {
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
        padding: '15px 20px', borderBottom: `1px solid ${T.line}`, minWidth: 0, background: T.bg,
      },
      title: {
        fontSize: 15.5, fontWeight: 600, lineHeight: '22px', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto', color: T.ink,
      },
      chip: {
        flex: '0 0 auto', fontSize: 11.5, lineHeight: '18px', padding: '2px 8px',
        borderRadius: 999, background: T.surfaceStrong, border: `1px solid ${T.line2}`, color: T.sub,
      },
      chipRound: {
        flex: '0 0 auto', fontSize: 11.5, lineHeight: '18px', padding: '2px 8px',
        borderRadius: 999, background: T.tint, border: `1px solid ${T.tintLine}`, color: T.accent,
      },
      grow: { flex: '1 1 auto', minWidth: 8 },
      body: { flex: '1 1 auto', display: 'flex', minHeight: 0, minWidth: 0 },
      left: {
        flex: '0 0 380px', width: 380, minHeight: 0, minWidth: 0, overflow: 'hidden',
        borderRight: `1px solid ${T.line}`, background: T.bg,
        display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto auto', gridAutoFlow: 'row',
      },
      guide: {
        flex: '0 0 auto', padding: '8px 20px', background: T.surface, borderBottom: `1px solid ${T.line}`,
        fontSize: 11.5, lineHeight: '17px', color: T.sub, wordBreak: 'break-word',
      },
      label: {
        flex: '0 0 auto', fontSize: 11.5, fontWeight: 600, letterSpacing: '.02em',
        color: T.sub, padding: '12px 16px 6px',
      },
      list: { minHeight: 0, overflowY: 'auto', padding: '0 12px 10px' },
      item: {
        display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%',
        boxSizing: 'border-box', textAlign: 'left', padding: '9px 10px', marginBottom: 4,
        borderRadius: 9, cursor: 'pointer', border: '1px solid transparent',
        background: 'transparent', fontFamily: 'inherit', color: T.ink,
      },
      itemOn: { border: `1px solid ${T.accent}`, background: T.tint },
      idx: {
        flex: '0 0 auto', width: 20, height: 20, borderRadius: 999, background: T.surfaceStrong,
        border: `1px solid ${T.line2}`, color: T.sub, fontSize: 11, lineHeight: '19px',
        textAlign: 'center', fontWeight: 600,
      },
      idxOn: { background: T.accent, border: `1px solid ${T.accent}`, color: T.onAccent },
      itemBody: { flex: '1 1 auto', minWidth: 0 },
      itemTitle: {
        fontSize: 13, fontWeight: 600, lineHeight: '18px', color: T.ink,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      itemRole: {
        fontSize: 11.5, lineHeight: '16px', color: T.sub, marginTop: 1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      count: {
        flex: '0 0 auto', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
        background: T.accent, color: T.onAccent, fontSize: 10.5, lineHeight: '18px',
        textAlign: 'center', fontWeight: 700,
      },
      editor: {
        borderTop: `1px solid ${T.line}`, padding: '10px 16px 12px',
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, minHeight: 0,
      },
      editorTitle: {
        fontSize: 12, fontWeight: 600, color: T.ink, lineHeight: '17px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      textarea: {
        width: '100%', height: 'min(84px, 14vh)', minHeight: 56, boxSizing: 'border-box', resize: 'none',
        padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.line2}`,
        background: T.bg, color: T.ink, fontSize: 12.5, lineHeight: '19px',
        fontFamily: 'inherit', outline: 'none',
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      addButton: {
        flex: '0 0 auto', height: 30, padding: '0 12px', borderRadius: 8,
        border: `1px solid ${T.line2}`, background: T.bg, color: T.ink,
        fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      },
      addButtonOff: { opacity: 0.45, cursor: 'default' },
      hint: {
        flex: '1 1 auto', minWidth: 0, fontSize: 11, lineHeight: '16px', color: T.faint,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      hintCenter: {
        flex: '1 1 auto', minWidth: 0, fontSize: 11, lineHeight: '16px', color: T.faint,
        textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      notes: { display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 'min(96px, 16vh)', overflowY: 'auto' },
      note: {
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 7,
        background: T.surfaceStrong, border: `1px solid ${T.line2}`, minWidth: 0,
      },
      noteWho: {
        flex: '0 0 auto', fontSize: 11, fontWeight: 700, color: T.accent, maxWidth: 96,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      noteText: {
        flex: '1 1 auto', minWidth: 0, fontSize: 12, lineHeight: '17px', color: T.ink,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      noteX: {
        flex: '0 0 auto', width: 18, height: 18, border: 0, borderRadius: 5,
        background: 'transparent', color: T.sub, cursor: 'pointer', fontSize: 13,
        lineHeight: '18px', padding: 0, fontFamily: 'inherit',
      },
      foot: {
        borderTop: `1px solid ${T.line}`, padding: '10px 16px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
      },
      confirm: {
        width: '100%', height: 44, border: 0, borderRadius: 10, background: T.accent,
        color: T.onAccent, fontSize: 14, fontWeight: 700, cursor: 'pointer',
        fontFamily: 'inherit', letterSpacing: '.01em',
      },
      confirmHover: { background: T.accentHover },
      confirmOff: { opacity: 0.5, cursor: 'default' },
      right: {
        flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex',
        flexDirection: 'column', background: T.surface,
      },
      rightHead: {
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8,
        padding: '13px 22px 10px', minWidth: 0,
      },
      back: {
        flex: '0 0 auto', height: 26, padding: '0 10px', borderRadius: 7,
        border: `1px solid ${T.line2}`, background: T.bg, color: T.ink,
        fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      },
      rightTitle: { fontSize: 12.5, fontWeight: 700, color: T.ink, lineHeight: '18px', whiteSpace: 'nowrap', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
      rightHint: {
        flex: '1 1 auto', minWidth: 0, fontSize: 11.5, color: T.sub, lineHeight: '18px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      scroll: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '2px 22px 22px' },
      card: {
        display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 11, background: T.bg,
        border: `1px solid ${T.line2}`, minWidth: 0, boxShadow: '0 1px 2px rgba(0,0,0,.05)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: T.ink, width: '100%',
        boxSizing: 'border-box',
      },
      rail: { flex: '0 0 auto', width: 22, display: 'flex', flexDirection: 'column', alignItems: 'center' },
      railDot: {
        width: 22, height: 22, borderRadius: 999, background: T.tint, color: T.accent,
        fontSize: 11.5, fontWeight: 700, lineHeight: '22px', textAlign: 'center',
      },
      railLine: { flex: '1 1 auto', width: 1, minHeight: 10, background: T.line2, margin: '3px 0' },
      cardBody: { flex: '1 1 auto', minWidth: 0 },
      cardTitleRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      cardTitle: {
        flex: '0 1 auto', minWidth: 0, fontSize: 13.5, fontWeight: 600, lineHeight: '19px',
        color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      role: {
        flex: '0 0 auto', maxWidth: 200, fontSize: 11, lineHeight: '17px', padding: '1px 7px',
        borderRadius: 999, background: T.surface, border: `1px solid ${T.line2}`, color: T.sub,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      summary: {
        marginTop: 4, fontSize: 12.5, lineHeight: '19px', color: T.sub,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
      previewBox: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.surfaceStrong, border: `1px solid ${T.line2}`, borderRadius: 10,
        padding: 8, maxHeight: 'min(54vh, 540px)', minHeight: 120, overflow: 'hidden', minWidth: 0,
      },
      previewImg: {
        display: 'block', maxWidth: '100%', maxHeight: 'min(52vh, 520px)',
        objectFit: 'contain', borderRadius: 6, background: T.bg,
      },
      previewHint: {
        marginTop: 6, fontSize: 11.5, lineHeight: '17px', color: T.faint,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      detail: {
        display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0,
        background: T.bg, border: `1px solid ${T.line2}`, borderRadius: 12, padding: '16px 18px',
      },
      detailKicker: {
        fontSize: 11, fontWeight: 600, letterSpacing: '.02em', color: T.faint,
        lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      detailTitleRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      detailIndex: {
        flex: '0 0 auto', width: 24, height: 24, borderRadius: 999, background: T.accent,
        color: T.onAccent, fontSize: 12, fontWeight: 700, lineHeight: '24px', textAlign: 'center',
      },
      detailTitle: {
        flex: '0 1 auto', minWidth: 0, fontSize: 16, fontWeight: 700, lineHeight: '23px',
        color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      block: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
      blockLabel: {
        fontSize: 11, fontWeight: 600, color: T.faint, lineHeight: '16px',
        letterSpacing: '.02em', whiteSpace: 'nowrap',
      },
      blockText: {
        fontSize: 13, lineHeight: '21px', color: T.ink, whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', overflowWrap: 'anywhere',
      },
      blockWarn: {
        fontSize: 13, lineHeight: '21px', color: 'var(--dsw-alias-state-error-primary)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere',
      },
      blockMuted: {
        fontSize: 13, lineHeight: '21px', color: T.sub, whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', overflowWrap: 'anywhere',
      },
      editTag: {
        marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 9px',
        borderRadius: 8, background: T.tint, border: `1px solid ${T.tintLine}`, minWidth: 0,
      },
      editTagTitle: { fontSize: 11, fontWeight: 700, color: T.accent, lineHeight: '15px' },
      editTagText: { fontSize: 12, lineHeight: '17px', color: T.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      empty: { padding: '28px 8px', textAlign: 'center', fontSize: 12.5, color: T.sub, lineHeight: '19px' },
      toast: {
        position: 'fixed', left: '50%', bottom: 34, transform: 'translateX(-50%)',
        zIndex: 2147483001, padding: '9px 16px', borderRadius: 999, background: T.ink,
        color: 'var(--dsw-alias-label-primary-inverted, #fff)', fontSize: 12.5,
        lineHeight: '18px', maxWidth: 520, textAlign: 'center',
        boxShadow: '0 8px 24px rgba(0,0,0,.24)',
      },
    }

    // ──────────────────────────────────────────────────────────────
    // 5. 极简 store：状态挂在模块级，弹窗与 toast 共享一份
    // ──────────────────────────────────────────────────────────────
    function createStore(initial) {
      let state = initial
      const subs = new Set()
      const get = () => state
      const set = (patch) => {
        state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch)
        for (const fn of subs) fn(state)
      }
      const subscribe = (fn) => {
        subs.add(fn)
        return () => { subs.delete(fn) }
      }
      return { get, set, subscribe }
    }

    const store = createStore({ open: false, review: null, toast: '' })
    let toastTimer = null

    const notify = (text) => {
      store.set({ toast: text })
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => store.set({ toast: '' }), TOAST_MS)
    }

    function useStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
      return store.get()
    }

    // ──────────────────────────────────────────────────────────────
    // 6. 传输层：POST 决定 / 轮询 pending
    // ──────────────────────────────────────────────────────────────
    let lastConfirmedSignature = ''

    async function postDecision(review, action, feedback, doneText) {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: review.id, action, feedback: feedback || [] }),
        })
        if (!res.ok) throw new Error('http ' + res.status)
        store.set({ open: false, review: null })
        if (action === 'confirm') lastConfirmedSignature = signatureOf(review)
        notify(doneText || (action === 'confirm' ? COPY.submitted(feedback && feedback.length) : COPY.cancelled))
        return true
      } catch (error) {
        notify(COPY.postFailed)
        return false
      }
    }

    function startPolling() {
      let stopped = false
      let timer = null
      const tick = async () => {
        if (stopped) return
        try {
          if (!store.get().open) {
            const res = await fetch(ENDPOINT, { cache: 'no-store' })
            if (res.ok) {
              const data = await res.json()
              const review = data && data.ok ? data.review : null
              if (review && review.id && !store.get().open) {
                if (signatureOf(review) === lastConfirmedSignature) {
                  // 同一份结构（比如模型误调了第二轮）：静默确认，不再弹一次窗。
                  postDecision(review, 'confirm', [], COPY.duplicate)
                } else {
                  store.set({ open: true, review })
                }
              }
            }
          }
        } catch (error) { /* 没有 wpac 会话时端点 404，下一轮再试 */ }
        timer = setTimeout(tick, POLL_MS)
      }
      tick()
      return () => { stopped = true; clearTimeout(timer) }
    }

    // ──────────────────────────────────────────────────────────────
    // 7. 组件
    // ──────────────────────────────────────────────────────────────
    function ModuleRow({ module: m, index: i, active, count, onPick }) {
      return h('div', {
        role: 'button', tabIndex: 0,
        style: active ? Object.assign({}, S.item, S.itemOn) : S.item,
        onClick: () => onPick(moduleKey(m, i)),
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(moduleKey(m, i)) } },
        title: moduleTitle(m, i),
      },
        h('span', { style: active ? Object.assign({}, S.idx, S.idxOn) : S.idx }, String(i + 1)),
        h('span', { style: S.itemBody },
          h('div', { style: S.itemTitle }, moduleTitle(m, i)),
          m && m.role ? h('div', { style: S.itemRole }, m.role) : null,
        ),
        count > 0 ? h('span', { style: S.count }, String(count)) : null,
      )
    }

    function Edits({ notes }) {
      if (!notes.length) return null
      return h('div', { style: S.editTag },
        h('div', { style: S.editTagTitle }, '待改 · ' + notes.length + ' 条'),
        notes.map((note, i) => h('div', { key: i, style: S.editTagText }, note.instruction)),
      )
    }

    function StructureFlow({ modules, notesOf, onPick }) {
      if (!modules.length) return h('div', { style: S.empty }, COPY.emptyModules)
      return h(React.Fragment, null,
        modules.map((m, i) => h('div', { key: moduleKey(m, i), style: { marginBottom: i === modules.length - 1 ? 0 : 10 } },
          h('div', {
            role: 'button', tabIndex: 0, style: S.card,
            onClick: () => onPick(moduleKey(m, i)),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(moduleKey(m, i)) } },
          },
            h('div', { style: S.rail },
              h('span', { style: S.railDot }, String(i + 1)),
              i === modules.length - 1 ? null : h('span', { style: S.railLine }),
            ),
            h('div', { style: S.cardBody },
              h('div', { style: S.cardTitleRow },
                h('span', { style: S.cardTitle }, moduleTitle(m, i)),
                m && m.role ? h('span', { style: S.role }, m.role) : null,
              ),
              m && m.summary ? h('div', { style: S.summary }, m.summary) : null,
              h(Edits, { notes: notesOf(moduleKey(m, i)) }),
            ),
          ),
        )),
      )
    }

    function ModuleDetail({ module: m, index: i, total, notes, meta, reviewId, hostPreview }) {
      const body = moduleText(m)
      const [imgBroken, setImgBroken] = React.useState(false)
      const hasPreview = Boolean(m && m.hasPreview)
      const showImage = hasPreview && !imgBroken
      const previewSrc = '/dsh-wpac-preview?review=' + encodeURIComponent(reviewId || '')
        + '&module=' + encodeURIComponent(moduleKey(m, i))
      return h('div', { style: S.detail },
        h('div', { style: S.detailKicker }, meta.kicker + ' · 第 ' + (i + 1) + ' / ' + total + ' ' + meta.unit),
        h('div', { style: S.detailTitleRow },
          h('span', { style: S.detailIndex }, String(i + 1)),
          h('span', { style: S.detailTitle }, moduleTitle(m, i)),
          m && m.role ? h('span', { style: S.role }, m.role) : null,
        ),
        m && m.summary
          ? h('div', { style: S.block },
              h('div', { style: S.blockLabel }, meta.job),
              h('div', { style: S.blockMuted }, m.summary),
            )
          : null,
        showImage
          ? h('div', { style: S.block },
              h('div', { style: S.blockLabel }, '这一' + meta.unit + '的预览'),
              h('div', { style: S.previewBox },
                h('img', {
                  src: previewSrc, alt: '这一页的预览图', style: S.previewImg,
                  onError: () => setImgBroken(true),
                }),
              ),
              h('div', { style: S.previewHint }, '图就是按确认后的结构渲染的那一' + meta.unit + '；看不清可以点下面的文字要点。'),
            )
          : null,
        h('div', { style: S.block },
          h('div', { style: S.blockLabel }, meta.body),
          h('div', { style: body ? S.blockText : S.blockWarn }, body || `模型没给这一${meta.unit}的内容（text 必填）。`),
          !hostPreview
            ? h('div', { style: S.previewHint }, '宿主还是旧版（没重启 App）：页面预览要从 0.7 的宿主才会加载，先看文字。')
            : (m && m.previewError === 'path-not-found'
                ? h('div', { style: S.previewHint }, '模型给的预览图路径找不到（已回退文字）。')
                : (m && m.previewError === 'not-image'
                    ? h('div', { style: S.previewHint }, '模型给的预览图不是图片（已回退文字）。')
                    : (!hasPreview && meta.unit !== '段'
                        ? h('div', { style: S.previewHint }, '模型没给这一' + meta.unit + '的预览图（会回退到文字）。')
                        : (hasPreview && imgBroken
                            ? h('div', { style: S.previewHint }, '预览图加载失败，已回退到文字。')
                            : null)))),
        ),
        notes.length
          ? h('div', { style: S.block },
              h('div', { style: S.blockLabel }, COPY.detailEdits),
              h(Edits, { notes }),
            )
          : null,
      )
    }

    function Editor({ current, draft, setDraft, notes, onAdd, onRemove, meta }) {
      return h('div', { style: S.editor },
        h('div', { style: S.editorTitle },
          current ? '针对「' + moduleTitle(current.module, current.index) + '」· 第 ' + (current.index + 1) + ' ' + meta.unit : COPY.editorFallback),
        h('textarea', {
          style: S.textarea, value: draft, placeholder: COPY.textareaPlaceholder,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onAdd() }
          },
        }),
        h('div', { style: S.row },
          h('button', {
            type: 'button',
            style: draft.trim() ? S.addButton : Object.assign({}, S.addButton, S.addButtonOff),
            onClick: onAdd,
          }, COPY.addNote),
          h('span', { style: S.hint }, COPY.addHint),
        ),
        notes.length
          ? h('div', { style: S.notes },
              notes.map((note, i) => h('div', { key: i, style: S.note },
                h('span', { style: S.noteWho }, note.moduleTitle),
                h('span', { style: S.noteText }, note.instruction),
                h('button', {
                  type: 'button', style: S.noteX, 'aria-label': '删除这条意见',
                  onClick: () => onRemove(i),
                }, '×'),
              )),
            )
          : null,
      )
    }

    function ConfirmBar({ notes, busy, hot, onConfirm, onHot }) {
      const style = busy
        ? Object.assign({}, S.confirm, S.confirmOff)
        : Object.assign({}, S.confirm, hot ? S.confirmHover : null)
      return h('div', { style: S.foot },
        h('button', {
          type: 'button', style, onClick: onConfirm,
          onMouseEnter: () => onHot(true), onMouseLeave: () => onHot(false),
        }, busy ? COPY.submitting : (notes.length ? COPY.confirmEdit(notes.length) : COPY.confirmDeliver)),
        h('div', { style: S.hintCenter }, notes.length ? COPY.noteEditHint : COPY.noteDeliverHint),
      )
    }

    function RightPane({ sel, modules, notesOf, onPick, onBack, meta, reviewId, hostPreview }) {
      const selected = sel === null ? null : modules.find((m, i) => moduleKey(m, i) === sel)
      if (sel !== null && selected) {
        const index = modules.indexOf(selected)
        return h('section', { style: S.right },
          h('div', { style: S.rightHead },
            h('button', { type: 'button', style: S.back, onClick: onBack }, COPY.backToOverview),
            h('span', { style: S.rightTitle }, moduleTitle(selected, index)),
          ),
          h('div', { style: S.scroll },
            h(ModuleDetail, { module: selected, index, total: modules.length, notes: notesOf(sel), meta, reviewId, hostPreview }),
          ),
        )
      }
      return h('section', { style: S.right },
        h('div', { style: S.rightHead },
          h('span', { style: S.rightTitle }, meta.struct),
          h('span', { style: S.rightHint }, '按交付顺序 · ' + modules.length + ' 个' + meta.unit + (totalNotes(notesOf, modules) ? ' · 待改 ' + totalNotes(notesOf, modules) + ' 处' : '')),
        ),
        h('div', { style: S.scroll }, h(StructureFlow, { modules, notesOf, onPick })),
      )
    }

    function totalNotes(notesOf, modules) {
      return modules.reduce((sum, m, i) => sum + notesOf(moduleKey(m, i)).length, 0)
    }

    function Modal({ review }) {
      const modules = Array.isArray(review.modules) ? review.modules : []
      const [sel, setSel] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [notes, setNotes] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [hotConfirm, setHotConfirm] = React.useState(false)

      const meta = metaOf(review)
      const notesOf = (key) => notes.filter((n) => n.moduleId === key)
      const indexOf = (key) => modules.findIndex((m, i) => moduleKey(m, i) === key)
      const current = sel !== null && indexOf(sel) >= 0 ? { module: modules[indexOf(sel)], index: indexOf(sel) } : null

      const onPick = (key) => setSel((prev) => (prev === key ? null : key))

      const onAdd = () => {
        const text = draft.trim()
        if (!text || !current) return
        setNotes((list) => list.concat([toNote(current.module, modules, text)]))
        setDraft('')
      }

      const onRemove = (index) => setNotes((list) => list.filter((_, i) => i !== index))

      const submit = async (action) => {
        if (busy) return
        setBusy(true)
        const okDone = await postDecision(review, action, action === 'confirm' ? notes : [])
        if (!okDone) setBusy(false)
      }

      React.useEffect(() => {
        const onKey = (e) => {
          const typing = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !typing) { e.preventDefault(); submit('confirm') }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      })

      return h('div', {
        style: S.backdrop,
        onMouseDown: (e) => { if (e.target === e.currentTarget) e.preventDefault() },
      },
        h('div', {
          style: S.panel, role: 'dialog', 'aria-modal': 'true',
          'aria-label': review.title || COPY.title,
        },
          h('div', { style: S.head },
            h('span', { style: S.title }, review.title || COPY.title),
            review.kind ? h('span', { style: S.chip }, review.kind) : null,
            h('span', { style: S.chip }, meta.tag),
            review.round ? h('span', { style: S.chipRound }, '第 ' + review.round + ' 轮') : null,
            h('span', { style: S.grow }),
          ),
          h('div', { style: S.guide }, COPY.guide),
          h('div', { style: S.body },
            h('aside', { style: S.left },
              h('div', { style: S.label }, COPY.selectLabel),
              h('div', { style: S.list },
                modules.length
                  ? modules.map((m, i) => h(ModuleRow, {
                      key: moduleKey(m, i), module: m, index: i,
                      active: sel === moduleKey(m, i),
                      count: notesOf(moduleKey(m, i)).length,
                      onPick,
                    }))
                  : h('div', { style: S.empty }, COPY.noModules),
              ),
              h(Editor, {
                current, draft, setDraft, notes, meta,
                onAdd, onRemove,
              }),
              h(ConfirmBar, {
                notes, busy, hot: hotConfirm,
                onConfirm: () => submit('confirm'),
                onHot: setHotConfirm,
              }),
            ),
            h(RightPane, {
              sel, modules, notesOf, meta, reviewId: review.id, hostPreview: Boolean(review.schemaVersion),
              onPick,
              onBack: () => setSel(null),
            }),
          ),
        ),
      )
    }

    function Toast({ text }) {
      return text ? h('div', { style: S.toast }, text) : null
    }

    function ReviewHost() {
      const s = useStore()
      return h(React.Fragment, null,
        s.open && s.review ? h(Modal, { review: s.review, key: s.review.id }) : null,
        h(Toast, { text: s.toast }),
      )
    }

    // ──────────────────────────────────────────────────────────────
    // 8. 插件面
    // ──────────────────────────────────────────────────────────────
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => {
          // 槽位真的挂上了才回一条 beacon：宿主 /tmp/wpac-review-boot.log 里能看到。
          try { fetch(ENDPOINT + '?hello=1', { cache: 'no-store' }).catch(() => {}) } catch (error) { /* ignore */ }
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'wpac-review-host',
            order: 90,
          }, ReviewHost)
        })
        startPolling()
      },
    }
  },
})
