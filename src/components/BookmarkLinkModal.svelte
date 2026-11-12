<svelte:options runes />

<script lang="ts">
  import { chooseFastestBookmarkUrl } from '../lib/bookmarkUrlRouter'

  type AsyncVoid<T = void> = T | Promise<T>

  interface Props {
    title?: string
    url?: string
    internalUrl?: string | null
    onClose?: () => AsyncVoid
  }

  let { title = '', url = '', internalUrl = '', onClose }: Props = $props()

  let resolvedUrl = $state('')
  let resolving = $state(false)
  let resolveToken = 0

  // props 变化（例如弹层复用时切换书签）也要重新选择地址；token 丢弃旧探测结果。
  $effect.pre(() => {
    const currentUrl = url
    const currentInternalUrl = internalUrl
    const token = ++resolveToken
    resolvedUrl = currentUrl

    if (!currentInternalUrl) {
      resolving = false
      return
    }

    resolving = true
    void chooseFastestBookmarkUrl({ url: currentUrl, internal_url: currentInternalUrl })
      .then((nextUrl) => {
        if (token === resolveToken) resolvedUrl = nextUrl
      })
      .catch(() => {
        if (token === resolveToken) resolvedUrl = currentUrl
      })
      .finally(() => {
        if (token === resolveToken) resolving = false
      })
  })

  function mountToBody(node: HTMLElement) {
    document.body.appendChild(node)

    return {
      destroy() {
        node.remove()
      },
    }
  }

  function handleClose() {
    void onClose?.()
  }
</script>

<div use:mountToBody class="link-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
  <div class="link-modal">
    <div class="link-modal-header">
      <strong>{title}</strong>
      <div class="link-modal-actions">
        {#if resolving}<span class="link-modal-status">正在选择最快地址…</span>{/if}
        <a href={resolvedUrl || url} target="_blank" rel="noopener noreferrer">新窗口打开</a>
        <button type="button" onclick={handleClose}>关闭</button>
      </div>
    </div>
    {#if resolvedUrl && !resolving}
      <iframe src={resolvedUrl} title={title}></iframe>
    {/if}
  </div>
</div>

<style>
  .link-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(15, 23, 42, 0.62);
    backdrop-filter: blur(4px);
  }

  .link-modal {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: min(1120px, 100%);
    height: min(760px, calc(100vh - 36px));
    overflow: hidden;
    border-radius: 18px;
    background: #ffffff;
    box-shadow: 0 26px 70px rgba(15, 23, 42, 0.32);
  }

  .link-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid #e2e8f0;
    color: #0f172a;
  }

  .link-modal-header strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-modal-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }

  .link-modal-status {
    align-self: center;
    color: #64748b;
    font-size: 12px;
  }

  .link-modal-actions a,
  .link-modal-actions button {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    background: #ffffff;
    color: #0f172a;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    padding: 7px 10px;
    text-decoration: none;
  }

  .link-modal iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #ffffff;
  }

  :global([data-theme='dark']) .link-modal {
    background: #0f172a;
  }

  :global([data-theme='dark']) .link-modal-header {
    border-color: rgba(148, 163, 184, 0.24);
    color: #e5eefb;
  }
</style>
