-- CreateTable
CREATE TABLE "Order" (
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "gatewayNames" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "isCod" BOOLEAN NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("shop", "orderId")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "shop" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("shop", "webhookId")
);

-- CreateIndex
CREATE INDEX "Order_shop_createdAt_orderId_idx" ON "Order"("shop", "createdAt", "orderId");

-- CreateIndex
CREATE INDEX "Session_shop_isOnline_idx" ON "Session"("shop", "isOnline");
