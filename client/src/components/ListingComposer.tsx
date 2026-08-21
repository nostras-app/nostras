import { useState } from 'react'
import { uploadToBlossom } from '../lib/blossom'
import { publishListing, type ListingImage } from '../lib/listing'

// NIP-99 classified listing composer. Buy Now (the DVM-mediated payment
// confirmation) only supports sats/btc/usd — see
// server/cmd/dvm/main.go's listingPriceSats — so the currency select is
// deliberately limited to those three rather than the free-text field
// the spec technically allows, so a seller can't accidentally publish a
// listing Buy Now will always reject.
const CURRENCIES = ['sats', 'usd', 'btc'] as const

export function ListingComposer() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [priceCurrency, setPriceCurrency] = useState<(typeof CURRENCIES)[number]>('sats')
  const [priceFrequency, setPriceFrequency] = useState('')
  const [location, setLocation] = useState('')
  const [categoriesInput, setCategoriesInput] = useState('')
  const [images, setImages] = useState<ListingImage[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingImage(true)
    try {
      for (const file of Array.from(files)) {
        const blob = await uploadToBlossom(file)
        setImages((prev) => [...prev, { url: blob.url }])
      }
    } finally {
      setUploadingImage(false)
    }
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((img) => img.url !== url))
  }

  const canPublish = title.trim() && description.trim() && priceAmount.trim() && !publishing

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true)
    setError(null)
    try {
      await publishListing({
        title,
        description,
        priceAmount,
        priceCurrency,
        priceFrequency: priceFrequency.trim() || undefined,
        location,
        categories: categoriesInput.split(',').map((c) => c.trim()).filter(Boolean),
        images,
      })

      setTitle('')
      setDescription('')
      setPriceAmount('')
      setPriceFrequency('')
      setLocation('')
      setCategoriesInput('')
      setImages([])
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish listing')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="article-composer">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What are you selling?"
      />
      <textarea
        className="textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description — condition, details, whatever a buyer needs to know"
        rows={5}
      />

      <div className="field-row">
        <input
          className="input"
          value={priceAmount}
          onChange={(e) => setPriceAmount(e.target.value)}
          placeholder="Price"
          inputMode="decimal"
        />
        <select
          className="input"
          value={priceCurrency}
          onChange={(e) => setPriceCurrency(e.target.value as (typeof CURRENCIES)[number])}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={priceFrequency}
          onChange={(e) => setPriceFrequency(e.target.value)}
          placeholder="per (optional — e.g. month)"
        />
      </div>

      <input
        className="input"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location (optional)"
      />
      <input
        className="input"
        value={categoriesInput}
        onChange={(e) => setCategoriesInput(e.target.value)}
        placeholder="Categories, comma-separated (optional)"
      />

      <div className="field-row">
        {images.map((img) => (
          <span key={img.url} className="listing-image-chip">
            <img src={img.url} alt="" />
            <button type="button" onClick={() => removeImage(img.url)} aria-label="Remove image">
              ×
            </button>
          </span>
        ))}
        <label className="btn btn-secondary btn-sm article-cover-upload-btn">
          {uploadingImage ? 'Uploading…' : 'Add photo'}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploadingImage}
            onChange={(e) => handleImageUpload(e.target.files)}
          />
        </label>
      </div>

      <div className="btn-row">
        {published && <span className="field-hint">Published!</span>}
        <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={!canPublish}>
          {publishing ? 'Publishing…' : 'Publish listing'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
