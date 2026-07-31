"use client";

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ModelCardSkeleton() {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3 flex flex-row justify-between items-start space-y-0">
        <div className="space-y-2 w-full">
          <Skeleton className="h-5 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pb-3 flex-1 flex flex-col justify-center">
        <div className="flex justify-between items-end mb-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-12" />
        </div>
        <Skeleton className="h-3 w-full" />
      </CardContent>
      
      <CardFooter className="pt-0 text-xs flex items-center gap-2">
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-24" />
      </CardFooter>
    </Card>
  );
}

export function QuotaGridSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <ModelCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
