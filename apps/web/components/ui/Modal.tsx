"use client"

import { motion } from "framer-motion"
import { FaTimes } from "react-icons/fa"
import { ReactNode } from "react"

// components/ui/Modal.tsx
//
// Shared modal shell: animated backdrop + panel + optional header (icon, title,
// close button). Replaces the duplicated bg-click + motion markup that used to
// live in UserListCard, BuyCard, BidCard, ColBidCard and the wallet dialog.
//
// The modal is *mounted* by the caller (typically inside an <AnimatePresence>),
// so exit animations are driven by that parent — this component doesn't wrap
// itself in AnimatePresence. `id` becomes the backdrop id (`${id}-bg`) used for
// click-out detection.

export interface ModalProps {
  /** Becomes the backdrop id `${id}-bg` for click-out detection. Must be unique. */
  id: string
  onClose: () => void
  title?: string
  icon?: ReactNode
  children: ReactNode
  /** Extra classes appended to the panel (e.g. sizing: min-w / max-h). */
  panelClassName?: string
  /** Replaces the default backdrop classes entirely when provided. */
  backdropClassName?: string
  /** Extra classes appended to the header row. */
  headerClassName?: string
  /** Replaces the default title classes (`font-bold text-2xl`) when provided. */
  titleClassName?: string
}

export function Modal({ id, onClose, title, icon, children, panelClassName, backdropClassName, headerClassName, titleClassName }: ModalProps) {
  return (
    <motion.div
      id={`${id}-bg`}
      onClick={(e: any) => {
        if (e.target.id === `${id}-bg`) onClose()
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={
        backdropClassName ??
        "fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50"
      }
    >
      <motion.div
        initial={{ opacity: 0, translateY: 50 }}
        animate={{ opacity: 1, translateY: 0 }}
        exit={{ opacity: 0, translateY: 50 }}
        transition={{ duration: 0.2 }}
        className={`flex flex-col card rounded-2xl border border-(--text)/20 overflow-hidden ${panelClassName ?? ""}`}
      >
        {title !== undefined && (
          <div className={`flex justify-between items-center p-4 ${headerClassName ?? ""}`}>
            <div className="flex items-center gap-3">
              {icon}
              <span className={titleClassName ?? "font-bold text-2xl"}>{title}</span>
            </div>
            <button onClick={onClose} className="bg-transparent! text-(--text)! hover:opacity-75">
              <FaTimes className="opacity-75" />
            </button>
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  )
}
