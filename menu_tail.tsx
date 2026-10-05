function AddCategoryForm({
  restaurantId,
  onCreated,
}: {
  restaurantId: string;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await menuApi.createCategory(restaurantId, { name });
      setName('');
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-dashed border-ink-200 p-4">
      <p className="mb-2 text-sm font-semibold text-ink-700">Add a category</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Starters"
          className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
}

function AddItemForm({
  restaurantId,
  categoryId,
  onDone,
  onCancel,
}: {
  restaurantId: string;
  categoryId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revokes the previous object URL whenever it's replaced or the form
  // unmounts — otherwise each picked file leaks its blob URL.
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      e.target.value = '';
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = Number(price);
    if (!name.trim() || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Enter a name and a valid, non-negative price.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Image upload needs a real item id, so it always happens as a
      // second step after creation — an item without a picked image
      // still creates in one step, exactly as before.
      const created = await menuApi.createMenuItem(restaurantId, {
        categoryId,
        name,
        description: description || undefined,
        price: parsedPrice,
      });
      if (imageFile) {
        try {
          await menuApi.uploadItemImage(restaurantId, created.id, imageFile);
        } catch (imgErr) {
          // The item itself was created successfully — don't lose that
          // by throwing here. Surface the image failure and still
          // refresh the list; the admin can retry the image via Edit.
          setError(
            `Item added, but the image failed to upload: ${
              imgErr instanceof Error ? imgErr.message : 'unknown error'
            }`,
          );
          await onDone();
          setBusy(false);
          return;
        }
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-xl bg-cream-100 p-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Item name"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        autoFocus
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Price (₹)"
        inputMode="decimal"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
      />

      <div className="flex items-center gap-3">
        {imagePreview ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-ink-200">
            <img src={imagePreview} alt="Selected item" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={clearImage}
              aria-label="Remove selected image"
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-200 text-ink-300">
            <span className="text-lg">🍽</span>
          </div>
        )}
        <label className="text-xs font-semibold text-brand-600">
          {imagePreview ? 'Change photo' : 'Add photo (optional)'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Add item
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-ink-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditItemForm({
  restaurantId,
  item,
  onDone,
  onCancel,
}: {
  restaurantId: string;
  item: MenuItemRecord;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [price, setPrice] = useState(String(item.price));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removingImage, setRemovingImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      e.target.value = '';
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // Removing the current image is its own immediate action, not staged
  // for "Save" — there's no ambiguity to defer (nothing else to
  // combine it with), and it means a mistaken tap on "Remove" is
  // reflected right away rather than sitting silently until Save.
  const removeCurrentImage = async () => {
    if (!confirm('Remove this item\u2019s photo?')) return;
    setRemovingImage(true);
    setError(null);
    try {
      await menuApi.removeItemImage(restaurantId, item.id);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove image.');
      setRemovingImage(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = Number(price);
    if (!name.trim() || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Enter a name and a valid, non-negative price.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await menuApi.updateMenuItem(restaurantId, item.id, {
        name,
        description: description || undefined,
        price: parsedPrice,
      });
      if (imageFile) {
        try {
          await menuApi.uploadItemImage(restaurantId, item.id, imageFile);
        } catch (imgErr) {
          setError(
            `Item saved, but the new image failed to upload: ${
              imgErr instanceof Error ? imgErr.message : 'unknown error'
            }`,
          );
          await onDone();
          setBusy(false);
          return;
        }
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item.');
      setBusy(false);
    }
  };

  const currentImageUrl = resolveImageUrl(item.imageUrl);

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-cream-100 p-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        autoFocus
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
      />

      <div className="flex items-center gap-3">
        {/* A newly-picked file's local preview always wins over the
            saved image while one is staged — it's what Save is about
            to upload. */}
        {imagePreview || currentImageUrl ? (
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-ink-200">
            <img src={imagePreview ?? currentImageUrl ?? ''} alt={item.name} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-200 text-ink-300">
            <span className="text-lg">🍽</span>
          </div>
        )}

        <div className="flex flex-col items-start gap-1">
          <label className="text-xs font-semibold text-brand-600">
            {currentImageUrl || imagePreview ? 'Replace photo' : 'Add photo (optional)'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          {currentImageUrl && !imagePreview && (
            <button
              type="button"
              onClick={removeCurrentImage}
              disabled={removingImage}
              className="text-xs font-semibold text-red-500 disabled:opacity-50"
            >
              {removingImage ? 'Removing…' : 'Remove photo'}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-ink-400">
          Cancel
        </button>
      </div>
    </form>
  );
}
