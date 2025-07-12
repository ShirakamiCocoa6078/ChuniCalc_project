import React, { useState, useMemo } from 'react';
import type { Song, ShowallApiSongEntry } from '@/types/result-page';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Search, X, PlusCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslation } from '@/lib/translations';
import { mapApiSongToAppSong } from '@/lib/rating-utils';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';


interface SimulationPlaylistProps {
  playlistSongs: Song[];
  allMusicData: ShowallApiSongEntry[];
  onAddSong: (song: Song) => void;
  onRemoveSong: (song: Song) => void;
  onUpdateTarget: (song: Song, newTargetScore: number) => void;
  onClose: () => void;
  onCalculate: () => void;
}

const rankScorePresets = {
    'SSS+': 1009000,
    'SSS': 1007500,
    'SS+': 1005000,
    'SS': 1000000,
};

export default function SimulationPlaylist({
  playlistSongs,
  allMusicData,
  onAddSong,
  onRemoveSong,
  onUpdateTarget,
  onClose,
  onCalculate,
}: SimulationPlaylistProps) {
    const { locale } = useLanguage();
    const [searchTerm, setSearchTerm] = useState('');
    const [popoverOpen, setPopoverOpen] = useState(false);

    const searchResults = useMemo(() => {
        if (searchTerm.length < 2) return [];
        return allMusicData
            .filter(song => song.title.toLowerCase().includes(searchTerm.toLowerCase()))
            .slice(0, 50); // Show more results
    }, [searchTerm, allMusicData]);

    const handleAddSong = (musicEntry: ShowallApiSongEntry) => {
        const newSong = mapApiSongToAppSong(musicEntry);
        onAddSong(newSong);
        setSearchTerm('');
        setPopoverOpen(false);
    };

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
        <div className="p-4 border-b">
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={getTranslation(locale, 'playlistSearchPlaceholder' as any) || "Search for a song to add..."}
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                if (!popoverOpen) setPopoverOpen(true);
                            }}
                            className="pl-8"
                        />
                    </div>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                        <CommandInput placeholder="Filter results..." value={searchTerm} onValueChange={setSearchTerm}/>
                        <CommandList>
                            <CommandEmpty>No results found.</CommandEmpty>
                            <CommandGroup>
                                {searchResults.map(music => (
                                    <CommandItem
                                        key={`${music.id}-${music.diff}`}
                                        onSelect={() => handleAddSong(music)}
                                        className="flex justify-between"
                                    >
                                        <span>{music.title} <span className="text-muted-foreground">{music.diff}</span></span>
                                        <PlusCircle className="h-4 w-4" />
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
      
      {/* Playlist Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {playlistSongs.map(song => (
          <Card key={`${song.id}-${song.diff}`} className="p-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{song.title}</p>
                <p className="text-sm text-muted-foreground">{song.diff} / Const: {song.chartConstant?.toFixed(1) ?? 'N/A'}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => onRemoveSong(song)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-1 flex-wrap">
                    {Object.entries(rankScorePresets).map(([rank, score]) => (
                        <Button key={rank} size="xs" variant="outline" onClick={() => onUpdateTarget(song, score)}>
                            {rank}
                        </Button>
                    ))}
                </div>
              <Input
                type="number"
                value={song.targetScore}
                onChange={(e) => onUpdateTarget(song, parseInt(e.target.value, 10) || 0)}
                className="w-28 h-8"
              />
            </div>
          </Card>
        ))}
        {playlistSongs.length === 0 && (
            <div className="text-center text-muted-foreground py-10">
                <p>{getTranslation(locale, 'playlistEmpty' as any) || "No songs added to the playlist yet."}</p>
                <p className="text-sm">{getTranslation(locale, 'playlistEmptyHint' as any) || "Use the search bar above to find and add songs."}</p>
            </div>
        )}
      </div>

      {/* Footer with Calculate Button */}
      <div className="p-4 border-t mt-auto">
        <Button className="w-full" onClick={onCalculate}>
          {getTranslation(locale, 'playlistCalculateButton' as any) || "이 목록으로 계산"}
        </Button>
      </div>
    </div>
  );
} 