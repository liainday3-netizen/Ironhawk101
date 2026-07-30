import { useState } from "react";
import { useListWatchlist, useAddWatchlistItem, useRemoveWatchlistItem } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Button, Input } from "@/components/ui/core";
import { useQueryClient } from "@tanstack/react-query";
import { getListWatchlistQueryKey } from "@workspace/api-client-react";
import { Trash2 } from "lucide-react";

export default function Watchlist() {
  const { data: watchlist, isLoading } = useListWatchlist();
  const addToken = useAddWatchlistItem();
  const removeToken = useRemoveWatchlistItem();
  const queryClient = useQueryClient();

  const [chain, setChain] = useState("solana");
  const [symbol, setSymbol] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const handleAdd = () => {
    if (!symbol || !address) return;
    addToken.mutate({
      data: { chain, tokenSymbol: symbol.toUpperCase(), tokenAddress: address, notes }
    }, {
      onSuccess: () => {
        setSymbol("");
        setAddress("");
        setNotes("");
        queryClient.invalidateQueries({ queryKey: getListWatchlistQueryKey() });
      }
    });
  };

  const handleRemove = (id: number) => {
    removeToken.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWatchlistQueryKey() });
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Add New Token Form */}
      <Card className="lg:col-span-4 h-fit">
        <CardHeader>ADD_MONITOR_TARGET</CardHeader>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-widest">CHAIN</label>
            <select 
              value={chain} 
              onChange={e => setChain(e.target.value)}
              className="flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary font-mono uppercase"
            >
              <option value="solana">SOLANA</option>
              <option value="ethereum">ETHEREUM</option>
              <option value="base">BASE</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-widest">SYMBOL</label>
            <Input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="e.g. WIF" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-widest">ADDRESS</label>
            <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Contract Address..." />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-widest">THESIS_NOTES</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why watch this?..." />
          </div>
          <Button onClick={handleAdd} className="mt-2 w-full" disabled={addToken.isPending}>
            {addToken.isPending ? "ADDING..." : "ADD_TARGET"}
          </Button>
        </CardContent>
      </Card>

      {/* Target List */}
      <Card className="lg:col-span-8">
        <CardHeader>ACTIVE_TARGETS</CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ASSET</TableHead>
                <TableHead>ADDRESS</TableHead>
                <TableHead>NOTES</TableHead>
                <TableHead className="text-right">ACTION</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground animate-pulse">LOADING_TARGETS...</TableCell></TableRow>
              ) : watchlist && watchlist.length > 0 ? (
                watchlist.map(item => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-bold text-foreground">{item.tokenSymbol}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{item.chain}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.tokenAddress.slice(0,6)}...{item.tokenAddress.slice(-4)}</TableCell>
                    <TableCell className="text-sm">{item.notes}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleRemove(item.id)} disabled={removeToken.isPending}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">NO_TARGETS_ACQUIRED</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}
