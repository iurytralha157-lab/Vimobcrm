package site

import (
	"github.com/jackc/pgx/v5/pgtype"
)

func scanSite(row siteScanner) (OrganizationSite, error) {
	var item OrganizationSite
	var maintenanceMessage, subdomain, customDomain, domainVerifiedAt, siteTitle, siteDescription pgtype.Text
	var logoURL, footerLogoURL, faviconURL, primaryColor, secondaryColor, accentColor pgtype.Text
	var whatsapp, phone, email, address, city, state pgtype.Text
	var instagram, facebook, youtube, linkedin pgtype.Text
	var aboutTitle, aboutText, aboutImageURL pgtype.Text
	var seoTitle, seoDescription, seoKeywords, googleAnalyticsID, googleSearchConsoleVerification pgtype.Text
	var heroImageURL, heroTitle, heroSubtitle, pageBannerURL pgtype.Text
	var logoWidth, logoHeight, watermarkOpacity, watermarkSize pgtype.Int4
	var watermarkEnabled, showAboutOnHome pgtype.Bool
	var watermarkLogoURL, watermarkPosition, aboutSubtitle pgtype.Text
	var aboutStats, aboutCheckmarks, aboutFeatures []byte
	var gtmID, metaPixelID, googleAdsID, headScripts, bodyScripts pgtype.Text

	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.IsActive,
		&item.MaintenanceMode,
		&maintenanceMessage,
		&subdomain,
		&customDomain,
		&item.DomainVerified,
		&domainVerifiedAt,
		&item.DomainVerificationToken,
		&siteTitle,
		&siteDescription,
		&logoURL,
		&footerLogoURL,
		&faviconURL,
		&primaryColor,
		&secondaryColor,
		&accentColor,
		&whatsapp,
		&phone,
		&email,
		&address,
		&city,
		&state,
		&instagram,
		&facebook,
		&youtube,
		&linkedin,
		&aboutTitle,
		&aboutText,
		&aboutImageURL,
		&seoTitle,
		&seoDescription,
		&seoKeywords,
		&googleAnalyticsID,
		&googleSearchConsoleVerification,
		&heroImageURL,
		&heroTitle,
		&heroSubtitle,
		&pageBannerURL,
		&logoWidth,
		&logoHeight,
		&watermarkEnabled,
		&watermarkOpacity,
		&watermarkLogoURL,
		&watermarkSize,
		&watermarkPosition,
		&item.SiteTheme,
		&item.BackgroundColor,
		&item.TextColor,
		&item.CardColor,
		&showAboutOnHome,
		&aboutSubtitle,
		&aboutStats,
		&aboutCheckmarks,
		&aboutFeatures,
		&gtmID,
		&metaPixelID,
		&googleAdsID,
		&headScripts,
		&bodyScripts,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return OrganizationSite{}, err
	}

	item.MaintenanceMessage = textPointer(maintenanceMessage)
	item.Subdomain = textPointer(subdomain)
	item.CustomDomain = textPointer(customDomain)
	item.DomainVerifiedAt = textPointer(domainVerifiedAt)
	item.SiteTitle = textPointer(siteTitle)
	item.SiteDescription = textPointer(siteDescription)
	item.LogoURL = textPointer(logoURL)
	item.FooterLogoURL = textPointer(footerLogoURL)
	item.FaviconURL = textPointer(faviconURL)
	item.PrimaryColor = textPointer(primaryColor)
	item.SecondaryColor = textPointer(secondaryColor)
	item.AccentColor = textPointer(accentColor)
	item.WhatsApp = textPointer(whatsapp)
	item.Phone = textPointer(phone)
	item.Email = textPointer(email)
	item.Address = textPointer(address)
	item.City = textPointer(city)
	item.State = textPointer(state)
	item.Instagram = textPointer(instagram)
	item.Facebook = textPointer(facebook)
	item.YouTube = textPointer(youtube)
	item.LinkedIn = textPointer(linkedin)
	item.AboutTitle = textPointer(aboutTitle)
	item.AboutText = textPointer(aboutText)
	item.AboutImageURL = textPointer(aboutImageURL)
	item.SEOTitle = textPointer(seoTitle)
	item.SEODescription = textPointer(seoDescription)
	item.SEOKeywords = textPointer(seoKeywords)
	item.GoogleAnalyticsID = textPointer(googleAnalyticsID)
	item.GoogleSearchConsoleVerification = textPointer(googleSearchConsoleVerification)
	item.HeroImageURL = textPointer(heroImageURL)
	item.HeroTitle = textPointer(heroTitle)
	item.HeroSubtitle = textPointer(heroSubtitle)
	item.PageBannerURL = textPointer(pageBannerURL)
	item.LogoWidth = intPointer(logoWidth)
	item.LogoHeight = intPointer(logoHeight)
	item.WatermarkEnabled = boolPointer(watermarkEnabled)
	item.WatermarkOpacity = intPointer(watermarkOpacity)
	item.WatermarkLogoURL = textPointer(watermarkLogoURL)
	item.WatermarkSize = intPointer(watermarkSize)
	item.WatermarkPosition = textPointer(watermarkPosition)
	item.ShowAboutOnHome = boolPointer(showAboutOnHome)
	item.AboutSubtitle = textPointer(aboutSubtitle)
	item.AboutStats = jsonPointer(aboutStats)
	item.AboutCheckmarks = jsonPointer(aboutCheckmarks)
	item.AboutFeatures = jsonPointer(aboutFeatures)
	item.GTMID = textPointer(gtmID)
	item.MetaPixelID = textPointer(metaPixelID)
	item.GoogleAdsID = textPointer(googleAdsID)
	item.HeadScripts = textPointer(headScripts)
	item.BodyScripts = textPointer(bodyScripts)

	return item, nil
}
