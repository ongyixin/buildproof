interface SkeletonProps {
  width?: string
  height?: string
  className?: string
}

export function Skeleton({ width = '100%', height = '16px', className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height }}
    />
  )
}

export function MinerCardSkeleton() {
  return (
    <div className="panel p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton width="8px" height="8px" className="rounded-full" />
          <Skeleton width="120px" height="11px" />
        </div>
        <Skeleton width="60px" height="18px" className="rounded-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton width="60px" height="9px" />
            <Skeleton width="80px" height="20px" />
          </div>
        ))}
      </div>
      <Skeleton width="100%" height="4px" className="rounded-sm" />
    </div>
  )
}

export function LeaderboardRowSkeleton() {
  return (
    <div className="panel flex items-center gap-4 px-5 py-4">
      <Skeleton width="28px" height="28px" className="rounded-sm" />
      <div className="flex-1 flex flex-col gap-2">
        <Skeleton width="140px" height="11px" />
        <Skeleton width="96px" height="4px" className="rounded-sm" />
      </div>
      <Skeleton width="48px" height="36px" />
    </div>
  )
}

export function ScoreTableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 border-t border-bp-border">
      {[...Array(7)].map((_, i) => (
        <Skeleton key={i} width={i === 0 ? '120px' : '64px'} height="12px" />
      ))}
    </div>
  )
}
