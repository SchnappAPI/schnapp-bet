'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type Table as TanstackTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { cn } from './cn';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  // Row height read from --row-h on <body> by default. Override here for
  // tables that need a different density than the global toggle.
  rowHeightPx?: number;
  // Sticky-first-column shadow when the user scrolls horizontally.
  stickyFirstColumn?: boolean;
  // Row hover / selection callbacks.
  onRowClick?: (row: Row<T>, e: React.MouseEvent) => void;
  // Optional empty / loading slots.
  emptyMessage?: string;
  // Tailwind class extension.
  className?: string;
  // Forwarded for callers that need imperative access.
  tableRef?: (table: TanstackTable<T>) => void;
}

const DEFAULT_ROW_H = 28;

export function DataTable<T>({
  columns,
  data,
  rowHeightPx,
  stickyFirstColumn = true,
  onRowClick,
  emptyMessage = 'No rows.',
  className,
  tableRef,
}: DataTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (tableRef) tableRef(table);

  const rows = table.getRowModel().rows;
  const rowHeight = rowHeightPx ?? DEFAULT_ROW_H;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  const totalHeight = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-auto rounded-md border border-border bg-surface',
        className
      )}
      style={{ ['--row-h' as string]: `${rowHeight}px` }}
    >
      <table
        className="w-full border-separate font-mono text-data tabular-nums"
        style={{ borderSpacing: 0 }}
      >
        <thead className="sticky top-0 z-20 bg-raised">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-border">
              {headerGroup.headers.map((header, i) => (
                <th
                  key={header.id}
                  className={cn(
                    'h-8 px-2 text-left text-micro uppercase text-fg-muted font-medium',
                    'border-b border-border bg-raised',
                    stickyFirstColumn && i === 0 && 'sticky left-0 z-30 border-r border-border',
                    'whitespace-nowrap'
                  )}
                  style={{ width: header.getSize() ? `${header.getSize()}px` : undefined }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={table.getAllColumns().length}
                className="h-12 text-center text-body text-fg-subtle"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {items.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={row.id}
                onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
                className={cn(
                  'absolute left-0 right-0 flex w-full border-b border-border-subtle',
                  onRowClick && 'cursor-pointer hover:bg-surface-hover'
                )}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${rowHeight}px`,
                }}
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'flex items-center px-2 text-fg',
                      stickyFirstColumn && i === 0 && 'sticky left-0 z-10 bg-surface border-r border-border',
                      'whitespace-nowrap'
                    )}
                    style={{
                      width: cell.column.getSize() ? `${cell.column.getSize()}px` : undefined,
                      flex: cell.column.getSize() ? '0 0 auto' : '1 1 auto',
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
