# Introduction

This application enables the printing of shipping labels from the carrier GLS as an integrated part of your packing process. 

# Installation

You install the application from the connection view in Thetis IMS. The name of the application is 'thetis-ims-gls-transport'.

Upon installation the application creates a carrier by the name 'GLS'.

# Configuration

In the data document of the carrier named 'GLS':

```
{
  "GLSTransport": {
    "password": "API1234",
    "userName": "2080060960",
    "contactId": "208a144Uoo",
    "customerId": "2080060960"
  }
}
```

For your convenience the application is initially configured to use our test account. You may use this configuration for test purposes.

To get your own credentials contact GLS.

# Shipment options

## Special services

### Deposit

To allow the deposit of the shipment at the customers address, write the text 'Deposit' in the terms of delivery field of the shipment. You can write where to deposit the shipment in the notes on delivery field (shipment.notesOnDelivery). Like this:

```
In green-house behind car-port.
``` 

### Flex

To choose flex delivery, write the text 'Flex' in the terms of delivery field of the shipment.

### Direct shop

To choose direct shop delivery, write the text 'DirectShop' in the terms of delivery field of the shipment.

### Private 

To choose private delivery, write the text 'Private' in the terms of delivery field of the shipment.

# Events

## Transport booking created

When a transport booking is created, the application registers the shipment with GLS. The shipment is updated with GLS shipment number.

The shipping containers are updated with the tracking numbers assigned to the corresponding GLS packages.

Shipping labels are attached to the transport booking.

