import React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("bg-card border border-border flex flex-col relative overflow-hidden", className)} {...props} />
  )
)
Card.displayName = "Card"

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-4 py-3 border-b border-border bg-muted/30 uppercase tracking-widest text-xs font-bold text-muted-foreground", className)} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 flex-1", className)} {...props} />
  )
)
CardContent.displayName = "CardContent"

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' | 'danger' | 'success', size?: 'sm' | 'md' | 'lg' }>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-mono font-bold tracking-widest uppercase transition-all disabled:opacity-50 disabled:pointer-events-none active:scale-95",
          {
            "bg-primary text-primary-foreground hover:bg-primary/90": variant === 'default',
            "border border-primary text-primary hover:bg-primary/10": variant === 'outline',
            "hover:bg-accent hover:text-accent-foreground": variant === 'ghost',
            "bg-[#ff3366] text-black hover:bg-[#ff3366]/90": variant === 'danger',
            "bg-[#00ff88] text-black hover:bg-[#00ff88]/90": variant === 'success',
            "h-8 px-3 text-xs": size === 'sm',
            "h-10 px-4 py-2 text-sm": size === 'md',
            "h-12 px-8 text-base": size === 'lg',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-10 w-full border border-border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 font-mono",
          className
        )}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export const Badge = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'success' | 'danger' | 'warning' | 'outline' }>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
          {
            "bg-primary/20 text-primary border border-primary/30": variant === 'default',
            "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30": variant === 'success',
            "bg-[#ff3366]/10 text-[#ff3366] border border-[#ff3366]/30": variant === 'danger',
            "bg-[#ffaa00]/10 text-[#ffaa00] border border-[#ffaa00]/30": variant === 'warning',
            "border border-border text-muted-foreground": variant === 'outline',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Badge.displayName = "Badge"

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm font-mono", className)} {...props} />
    </div>
  )
}
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b border-border bg-muted/50 text-xs tracking-widest text-muted-foreground", className)} {...props} />
}
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted", className)} {...props} />
}
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-10 px-4 text-left align-middle font-bold text-muted-foreground [&:has([role=checkbox])]:pr-0", className)} {...props} />
}
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
}

export function AnimatedPulse({ color = 'primary' }: { color?: 'primary' | 'success' | 'danger' | 'warning' }) {
  return (
    <div className="relative flex h-2 w-2">
      <span className={cn(
        "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
        {
          "bg-primary": color === 'primary',
          "bg-[#00ff88]": color === 'success',
          "bg-[#ff3366]": color === 'danger',
          "bg-[#ffaa00]": color === 'warning',
        }
      )}></span>
      <span className={cn(
        "relative inline-flex rounded-full h-2 w-2",
         {
          "bg-primary": color === 'primary',
          "bg-[#00ff88]": color === 'success',
          "bg-[#ff3366]": color === 'danger',
          "bg-[#ffaa00]": color === 'warning',
        }
      )}></span>
    </div>
  )
}
