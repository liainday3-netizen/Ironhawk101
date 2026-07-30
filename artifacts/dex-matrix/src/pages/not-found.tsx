export default function NotFound() {
  return (
    <div className="h-full flex items-center justify-center flex-col gap-4 text-destructive font-mono font-bold tracking-widest text-center">
      <div className="text-6xl animate-pulse">404</div>
      <div className="uppercase">SYS_ERR: SECTOR_NOT_FOUND</div>
    </div>
  )
}
