"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Address } from "viem"
import { FaCheck, FaUser } from "react-icons/fa"
import { FiEdit3 } from "react-icons/fi"
import { Modal } from "@/components/ui/Modal"
import { IpfsImage } from "@/components/features/nft/IpfsImage"
import { updateProfile } from "@/actions/profile/updateProfile"
import { ProfileNftOption, UserProfile } from "@/types/user.types"

interface UserProfileEditorProps {
  userAddress: Address
  profile: UserProfile | null
  avatarOptions: ProfileNftOption[]
  onClose: () => void
}

export function UserProfileEditor({ userAddress, profile, avatarOptions, onClose }: UserProfileEditorProps) {
  const router = useRouter()
  const [username, setUsername] = useState(profile?.username ?? "")
  const [bio, setBio] = useState(profile?.bio ?? "")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url || null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const trimmedUsername = username.trim()
  const usernameError =
    trimmedUsername.length > 0 && (trimmedUsername.length < 3 || !/^[a-zA-Z0-9_.-]+$/.test(trimmedUsername))
      ? "Username must be 3-30 characters using letters, numbers, dots, underscores or hyphens."
      : null

  const close = () => {
    if (!saving) onClose()
  }

  const handleSave = async () => {
    if (saving || usernameError) return

    setSaving(true)
    setError(null)

    try {
      const result = await updateProfile({ wallet: userAddress, username, bio, avatarUrl })
      if (!result.success) {
        setError(result.error)
        return
      }

      router.refresh()
      onClose()
    } catch {
      setError("Unable to update profile. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal id="profile-editor" onClose={close} title="Edit profile" icon={<FiEdit3 />} panelClassName="w-[min(92vw,640px)] max-h-[90vh]">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
        className="flex flex-col gap-5 overflow-y-auto p-4 pt-0"
      >
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-(--text)/20 bg-(--bg)">
            {avatarUrl ? (
              <IpfsImage src={avatarUrl} alt="Profile picture" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <FaUser className="text-2xl opacity-40" />
              </div>
            )}
          </div>
          <p className="text-sm opacity-70">Choose one of your NFTs as your profile picture, or leave it empty to use the default avatar.</p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={30}
            autoComplete="nickname"
            placeholder="your-name"
            className="rounded border border-(--text)/20 bg-(--bg) p-3"
          />
          <span className="text-xs opacity-60">3-30 characters. Letters, numbers, dots, underscores and hyphens only.</span>
          {usernameError && <span className="text-xs text-red-400">{usernameError}</span>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-sm font-semibold">
            <span>Bio</span>
            <span className="text-xs font-normal opacity-60">{bio.length}/280</span>
          </span>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={280}
            rows={4}
            placeholder="Tell people a little about yourself"
            className="resize-none rounded border border-(--text)/20 bg-(--bg) p-3"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Profile picture</span>
          <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded border border-(--text)/10 p-2 sm:grid-cols-6">
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              title="No profile picture"
              className={
                "relative aspect-square overflow-hidden rounded-lg border-2 bg-(--bg)! p-0 " +
                (avatarUrl === null ? "border-(--accent)!" : "border-transparent! hover:border-(--text)/30!")
              }
            >
              <span className="flex h-full w-full items-center justify-center">
                <FaUser className="text-lg opacity-40" />
              </span>
              {avatarUrl === null && <FaCheck className="absolute right-1 top-1 text-xs text-(--accent)" />}
            </button>

            {avatarOptions.map((option) => {
              const selected = avatarUrl === option.image_url
              const label = option.name ?? `#${option.token_id}`

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAvatarUrl(option.image_url)}
                  title={label}
                  className={
                    "relative aspect-square overflow-hidden rounded-lg border-2 bg-(--bg)! p-0 " +
                    (selected ? "border-(--accent)!" : "border-transparent! hover:border-(--text)/30!")
                  }
                >
                  <IpfsImage src={option.image_url} alt={label} className="h-full w-full object-cover" />
                  {selected && <FaCheck className="absolute right-1 top-1 text-xs text-(--accent)" />}
                </button>
              )
            })}
          </div>
          {avatarOptions.length === 0 && <p className="text-xs opacity-60">You don&apos;t own any NFTs with images yet.</p>}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded border border-(--text)/20 bg-transparent! px-4 py-2 text-(--text)! disabled:opacity-50"
          >
            Cancel
          </button>
          <button type="submit" disabled={saving || Boolean(usernameError)} className="rounded px-4 py-2 font-semibold disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
