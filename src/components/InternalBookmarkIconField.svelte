<svelte:options runes />

<script lang="ts">
  interface Props {
    externalUrl?: string
    internalUrl?: string
    loading?: boolean
    disabled?: boolean
    status?: string
    onParseExternal?: () => void
    onParseInternal?: () => void
    onFileSelected?: (file: File) => void
  }

  let {
    externalUrl = '',
    internalUrl = '',
    loading = false,
    disabled = false,
    status = '',
    onParseExternal,
    onParseInternal,
    onFileSelected,
  }: Props = $props()

  let fileInput = $state<HTMLInputElement | null>(null)
  const hasExternal = $derived(Boolean(externalUrl.trim()))
  const hasInternal = $derived(Boolean(internalUrl.trim()))
  const visible = $derived(hasExternal || hasInternal)

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) onFileSelected?.(file)
    input.value = ''
  }
</script>

{#if visible}
  <div class="icon-resolver-field">
    <div class="icon-resolver-heading">
      <span>地址图标解析</span>
      <small>优先由服务端/浏览器解析内外网图标；受 CORS、证书或混合内容限制时，可选择文件上传后端缓存。</small>
    </div>
    <div class="icon-resolver-actions">
      <button
        type="button"
        class="ghost-button"
        onclick={() => onParseExternal?.()}
        disabled={disabled || loading || !hasExternal}
      >
        解析外网图标
      </button>
      <button
        type="button"
        class="ghost-button"
        onclick={() => onParseInternal?.()}
        disabled={disabled || loading || !hasInternal}
      >
        解析内网图标
      </button>
      <button
        type="button"
        class="ghost-button"
        onclick={() => fileInput?.click()}
        disabled={disabled || loading}
      >
        选择图标文件
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        aria-label="选择图标文件"
        onchange={handleFileChange}
      />
    </div>
    {#if status}
      <small class="icon-resolver-status">{status}</small>
    {/if}
  </div>
{/if}

<style>
  .icon-resolver-field {
    grid-column: 1 / -1;
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    background: #f8fafc;
  }

  .icon-resolver-heading {
    display: grid;
    gap: 2px;
    color: #334155;
    font-size: 13px;
  }

  .icon-resolver-heading small,
  .icon-resolver-status {
    color: #64748b;
    font-size: 11px;
    line-height: 1.45;
  }

  .icon-resolver-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .icon-resolver-actions input[type='file'] {
    display: none;
  }

  .ghost-button {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    background: #ffffff;
    color: #0f172a;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    padding: 6px 10px;
  }

  .ghost-button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  :global([data-theme='dark']) .icon-resolver-field {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.45);
  }

  :global([data-theme='dark']) .icon-resolver-heading,
  :global([data-theme='dark']) .ghost-button {
    color: #e5eefb;
  }

  :global([data-theme='dark']) .ghost-button {
    border-color: rgba(148, 163, 184, 0.32);
    background: rgba(15, 23, 42, 0.72);
  }
</style>
