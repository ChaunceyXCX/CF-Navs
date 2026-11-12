<svelte:options runes />

<script lang="ts">
  interface Props {
    internalUrl?: string
    loading?: boolean
    disabled?: boolean
    status?: string
    onParse?: () => void
    onFileSelected?: (file: File) => void
  }

  let {
    internalUrl = '',
    loading = false,
    disabled = false,
    status = '',
    onParse,
    onFileSelected,
  }: Props = $props()

  let fileInput = $state<HTMLInputElement | null>(null)

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) onFileSelected?.(file)
    input.value = ''
  }
</script>

{#if internalUrl.trim()}
  <div class="internal-icon-field">
    <div class="internal-icon-heading">
      <span>内网图标</span>
      <small>录入内网地址后优先在浏览器侧解析；解析结果会随保存写入后端缓存。</small>
    </div>
    <div class="internal-icon-actions">
      <button
        type="button"
        class="ghost-button"
        onclick={() => onParse?.()}
        disabled={disabled || loading}
      >
        {loading ? '解析中…' : '解析内网图标'}
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
        aria-label="选择内网图标文件"
        onchange={handleFileChange}
      />
    </div>
    {#if status}
      <small class="internal-icon-status">{status}</small>
    {/if}
  </div>
{/if}

<style>
  .internal-icon-field {
    grid-column: 1 / -1;
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    background: #f8fafc;
  }

  .internal-icon-heading {
    display: grid;
    gap: 2px;
    color: #334155;
    font-size: 13px;
  }

  .internal-icon-heading small,
  .internal-icon-status {
    color: #64748b;
    font-size: 11px;
    line-height: 1.45;
  }

  .internal-icon-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .internal-icon-actions input[type='file'] {
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

  :global([data-theme='dark']) .internal-icon-field {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.45);
  }

  :global([data-theme='dark']) .internal-icon-heading,
  :global([data-theme='dark']) .ghost-button {
    color: #e5eefb;
  }

  :global([data-theme='dark']) .ghost-button {
    border-color: rgba(148, 163, 184, 0.32);
    background: rgba(15, 23, 42, 0.72);
  }
</style>
