/**
 * Copyright 2021 Thetis Apps Aps
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const axios = require('axios');

const countryCodeLookup = require('country-code-lookup');

var { DateTime } = require('luxon');

function createGLSAddress(address, contactPerson) {
	var glsAddress = new Object(); 
	if (contactPerson != null) {
		glsAddress.contact = contactPerson.name;
		glsAddress.email = contactPerson.email;
		glsAddress.mobile = contactPerson.mobileNumber;
		glsAddress.phone = contactPerson.phoneNumber;
	} 
	glsAddress.name1 = address.addressee;
	glsAddress.street1 = address.streetNameAndNumber;
	glsAddress.zipCode = address.postalCode;
	glsAddress.city = address.cityTownOrVillage;
	try {
		glsAddress.countryNum = countryCodeLookup.byIso(address.countryCode).isoNo;
	} catch (error) {
	    // Ignore - call to GLS will fail if country code is required
	}
	return glsAddress;
}

/**
 * Send a response to CloudFormation regarding progress in creating resource.
 */
async function sendResponse(input, context, responseStatus, reason) {

	let responseUrl = input.ResponseURL;

	let output = new Object();
	output.Status = responseStatus;
	output.PhysicalResourceId = "StaticFiles";
	output.StackId = input.StackId;
	output.RequestId = input.RequestId;
	output.LogicalResourceId = input.LogicalResourceId;
	output.Reason = reason;
	await axios.put(responseUrl, output);
}


var dataSchema = { type: 'object', properties: {
				"userName": {"type": "string"}, 
				"password": {"type": "string"}, 
				"contactId": {"type": "string"}, 
				"customerId": {"type": "string"}}};

exports.initializer = async (input, context) => {
	
	try {
		let ims = await getIMS();
		let requestType = input.RequestType;
		if (requestType == "Create") {
			
			// A default setup to fall back on if no seller specified
			
			let setup = new Object();
			setup.userName = '2080060960';
			setup.password = 'API1234';
			setup.contactId = '208a144Uoo';
			setup.customerId = '2080060960';
			
			// Create the GLS carrier

			let carrier = new Object();
			carrier.carrierName = "GLS";
			carrier.dataDocument = JSON.stringify({ GLSTransport: setup });
			await ims.post("carriers", carrier);

			// Create a data extension to the seller entity

			let dataExtension = { entityName: 'seller', dataExtensionName: 'GLSTransport', dataSchema: JSON.stringify(dataSchema) };
			await ims.post('dataExtensions', dataExtension);
			
		} else if (requestType == 'Update') {
			
			// Update the data extension to the seller entity
			
			let response = await ims.get('dataExtensions');
			let dataExtensions = response.data;
			let found = false;
			let i = 0;
			while (i < dataExtensions.length && !found) {
				let dataExtension = dataExtensions[i];
				if (dataExtension.entityName == 'seller' && dataExtension.dataExtensionName == 'GLSTransport') {
					found = true;
				} else {
					i++;
				}
			}
			if (found) {
				let dataExtension = dataExtensions[i];
				await ims.patch('dataExtensions/' + dataExtension.id, { dataSchema: JSON.stringify(dataSchema) });
			} else {
				let dataExtension = { entityName: 'seller', dataExtensionName: 'GLSTransport', dataSchema: JSON.stringify(dataSchema) };
				await ims.post('dataExtensions', dataExtension);
			}
			
		}
		
		await sendResponse(input, context, "SUCCESS", "OK");

	} catch (error) {
		await sendResponse(input, context, "SUCCESS", JSON.stringify(error));
	}

};

var cachedIMS = null;

async function getIMS() {
	
	if (cachedIMS == null) {
		
	    const authUrl = "https://auth.thetis-ims.com/oauth2/";
	    const apiUrl = "https://api.thetis-ims.com/2/";
	
		var clientId = process.env.ClientId;   
		var clientSecret = process.env.ClientSecret; 
		var apiKey = process.env.ApiKey;  
		
	    let data = clientId + ":" + clientSecret;
		let base64data = Buffer.from(data, 'UTF-8').toString('base64');	
		
		var imsAuth = axios.create({
				baseURL: authUrl,
				headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
				responseType: 'json'
			});
	    
	    var response = await imsAuth.post("token", 'grant_type=client_credentials');
	    var token = response.data.token_type + " " + response.data.access_token;
	    
	    var ims = axios.create({
	    		baseURL: apiUrl,
	    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
	    	});
		
	
		ims.interceptors.response.use(function (response) {
				console.log("SUCCESS " + JSON.stringify(response.data));
	 	    	return response;
			}, function (error) {
				console.log(JSON.stringify(error));
				if (error.response) {
					console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
				}
		    	return Promise.reject(error);
			});
		
		cachedIMS = ims;
	}
	
	return cachedIMS;
}

async function getGLS() {
 
    const glsUrl = "https://api.gls.dk/ws/DK/V1/";
    
    var gls = axios.create({
		baseURL: glsUrl,
		validateStatus: function (status) {
		    return status >= 200 && status < 300 || status == 400 || status == 500; // default
		}
	});
	
	gls.interceptors.response.use(function (response) {
			console.log("SUCCESS Status: " + response.status + " Body: " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});

	return gls;
}

function lookupCarrier(carriers, carrierName) {
	let i = 0;
    let found = false;
    while (!found && i < carriers.length) {
    	let carrier = carriers[i];
    	if (carrier.carrierName == carrierName) {
    		found = true;
    	} else {
    		i++;
    	}	
    }
    
    if (!found) {
    	throw new Error('No carrier by the name ' + carrierName);
    }

	return carriers[i];
}

async function book(ims, detail) {
	
	let gls = await getGLS();

	let shipmentId = detail.shipmentId;
	let contextId = detail.contextId;
	
    let response = await ims.get("shipments/" + shipmentId);
    let shipment = response.data;
    
	let seller;
    let setup;
    if (shipment.sellerId != null) {
	    response = await ims.get("sellers/" + shipment.sellerId);
	    seller = response.data;
	    let dataDocument = JSON.parse(seller.dataDocument);
	    setup = dataDocument.GLSTransport;
     } else {
	    response = await ims.get("carriers");
	    let carriers = response.data;
	    let carrier = lookupCarrier(carriers, 'GLS');
	    let dataDocument = JSON.parse(carrier.dataDocument);
	    setup = dataDocument.GLSTransport;
    }
    
	let glsShipment = new Object();
	
	glsShipment.userName = setup.userName;
	glsShipment.password = setup.password;
	glsShipment.customerId = setup.customerId;
	glsShipment.contactid = setup.contactId;
	glsShipment.shipmentDate = DateTime.local().toFormat('yyyyMMdd');
	glsShipment.reference = shipment.shipmentNumber;
	
	let i = 1;
	let parcels = [];
	let shippingContainers = [];
	shippingContainers = shipment.shippingContainers;
	shippingContainers.forEach(function(shippingContainer) {
		let glsParcel = new Object();
		glsParcel.reference = shipment.shipmentNumber + " #" + i;
		glsParcel.weight = shippingContainer.grossWeight;
		parcels.push(glsParcel);
		i++;
	});
	
	glsShipment.parcels = parcels;
	
	let glsAddresses = new Object();
	
	let contactPerson = shipment.contactPerson;
	
	let glsDeliveryAddress = createGLSAddress(shipment.deliveryAddress, contactPerson);
	
	let senderAddress;
	let senderContactPerson;
	if (seller != null) {
		senderAddress = seller.address;
		senderContactPerson = seller.contactPerson;
	} else {
		response = await ims.get("contexts/" + contextId);
		let context = response.data;
		senderAddress = context.address;
		senderContactPerson = context.contactPerson;
	}
	let glsAlternativeShipper = createGLSAddress(senderAddress, senderContactPerson);
	
	glsAddresses.delivery = glsDeliveryAddress;
	glsAddresses.alternativeShipper = glsAlternativeShipper;
	
	glsShipment.addresses = glsAddresses;
	
	let glsServices = new Object();
	if (shipment.pickUpPointId != null) {
		glsServices.shopDelivery = shipment.pickUpPointId;
	}	
	if (contactPerson != null) {
		glsServices.setNotificationEmail = contactPerson.email;
	}
	let notesOnDelivery = shipment.notesOnDelivery;
	let termsOfDelivery = shipment.termsOfDelivery;
	if (termsOfDelivery != null) {
		if (termsOfDelivery.includes("Deposit")) {
			glsServices.deposit = notesOnDelivery;
		}
		if (termsOfDelivery.includes("Flex")) {
			glsServices.flexDelivery = "Y";
		}
		if (termsOfDelivery.includes("DirectShop")) {
			glsServices.directShop = "Y";
		}
		if (termsOfDelivery.includes("Private")) {
			glsServices.privateDelivery = "Y";
		}
	}
	glsShipment.services = glsServices;

    response = await gls.post("CreateShipment", glsShipment);

	if (response.status == 400) {
		
		let errorResponse = response.data;
		let messageText = errorResponse.Message + ' ';
		for (let field in errorResponse.ModelState) {
			messageText = messageText + errorResponse.ModelState[field] + ' ';
		}
		
		let message = new Object();
		message.time = Date.now();
		message.source = "GLSTransport";
		message.messageType = "ERROR";
		message.messageText = "Failed to register shipment " + shipment.shipmentNumber + " with GLS. GLS says: " + messageText;
		message.deviceName = detail.deviceName;
		message.userId = detail.userId;
		await ims.post("events/" + detail.eventId + "/messages", message);
		
		return null;
		
	} 
	
	if (response.status == 500) {

		let message = new Object();
		message.time = Date.now();
		message.source = "GLSTransport";
		message.messageType = "ERROR";
		message.messageText = "Failed to register shipment " + shipment.shipmentNumber + " with GLS due to internal error on their server.";
		message.deviceName = detail.deviceName;
		message.userId = detail.userId;
		await ims.post("events/" + detail.eventId + "/messages", message);
	
		return null;	
	} 

    let glsResponse = response.data;
    
    console.log(JSON.stringify(glsResponse));
    
	parcels = glsResponse.Parcels;
	for (let i = 0; i < parcels.length; i++) {
		let shippingContainer = shippingContainers[i];
		let parcel = parcels[i];
		let trackingUrl = 'https://gls-group.eu/DK/da/find-pakke?txtAction=71000&match=' + parcel.ParcelNumber;
		await ims.patch("shippingContainers/" + shippingContainer.id, { trackingNumber: parcel.ParcelNumber, trackingUrl: trackingUrl });
	}

	await ims.patch("shipments/" + detail.shipmentId, { carriersShipmentNumber: glsResponse.ConsignmentId });

	return { base64EncodedContent: glsResponse.PDF, fileName: "SHIPPING_LABEL_" + detail.documentId + ".pdf" };
}

exports.bookingHandler = async (event, context) => {

    console.info(JSON.stringify(event));

    var detail = event.detail;

	let ims = await getIMS();

	await ims.patch('/documents/' + detail.documentId, { workStatus: 'ON_GOING' });
	
    let label = await book(ims, detail);
    
    if (label != null) {
		await ims.post('/documents/' + detail.documentId + '/attachments', label);
		await ims.patch('/documents/' + detail.documentId, { workStatus: 'DONE' });
    } else {
		await ims.patch('/documents/' + detail.documentId, { workStatus: 'FAILED' });
    }
    
	return "done";
	
};

